from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any, Dict, Generator, List

from app.config import settings
from app.database import record_agent_event

from .base_agent import get_openai_client, parse_llm_json, sanitize_provider_error
from .guardrails import evaluate_guardrails
from .tools import call_tool

try:
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover - dependency/runtime guard
    END = None
    StateGraph = None  # type: ignore


GRAPH_VERSION = "judge-feedback-agentic-v1"
AGENT_TOOL_EXECUTOR = ThreadPoolExecutor(max_workers=4)


TASK_TOOL_PLANS: Dict[str, List[str]] = {
    "requirement_intake": ["build_requirements"],
    "requirement_profile": ["build_requirements"],
    "resume_profile": [
        "parse_resume",
        "analyze_bias",
    ],
    "inbound_application": [
        "parse_resume",
        "analyze_bias",
        "match_candidate",
        "generate_screening_questions",
        "create_or_update_application",
    ],
    "existing_candidate_application": [
        "analyze_bias",
        "match_candidate",
        "generate_screening_questions",
        "create_or_update_application",
    ],
    "sandbox_evaluation": [
        "evaluate_screening_answers",
        "generate_report",
        "save_screening_evaluation",
        "update_application_status",
        "plan_candidate_email",
        "send_agent_email",
    ],
    "sourced_candidate": [
        "analyze_bias",
        "match_candidate",
        "generate_screening_questions",
        "generate_report",
        "stage_sourced_candidate",
        "plan_candidate_email",
        "send_agent_email",
    ],
}


class RecruitingAgentGraph:
    """Small graph runtime with LangGraph-compatible node semantics.

    The implementation keeps explicit graph nodes and evented state transitions
    while avoiding a hard dependency at import time. If LangGraph is installed,
    the project has the dependency available for future visual/runtime expansion;
    this class is the production-safe orchestration layer used by the current API.
    """

    def run(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        state = self._initial_state(initial_state)
        for _event in self.stream(state):
            pass
        return state

    def stream(self, initial_state: Dict[str, Any]) -> Generator[Dict[str, Any], None, Dict[str, Any]]:
        state = self._initial_state(initial_state)
        yield from self._guardrail_node(state)
        if state.get("blocked"):
            yield self._final_event(state)
            return state
        if settings.AGENT_SUPERVISOR_MODE == "single_plan":
            yield from self._prepare_supervisor_node(state)

        steps = 0
        while not state.get("complete") and steps < settings.AGENT_MAX_STEPS:
            steps += 1
            next_tool = self._supervisor_node(state)
            if not next_tool:
                skip = state.pop("last_supervisor_skip", None)
                if skip:
                    yield self._event(
                        state,
                        "supervisor",
                        "skipped",
                        f"Supervisor skipped tool: {skip.get('tool')}",
                        skip,
                    )
                state["complete"] = True
                break
            decision = state.get("last_supervisor_decision") or {"tool": next_tool}
            yield self._event(
                state,
                "supervisor",
                "decision",
                f"Supervisor selected tool: {next_tool}",
                decision,
            )
            yield from self._tool_node(state, next_tool)

        if steps >= settings.AGENT_MAX_STEPS and not state.get("complete"):
            state["complete"] = True
            state["agent_warnings"].append("Agent stopped after AGENT_MAX_STEPS.")
            yield self._event(state, "supervisor", "stop", "Agent stopped after maximum step count.")
        yield self._final_event(state)
        return state

    def _initial_state(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        if initial_state.get("_graph_initialized"):
            return initial_state
        return {
            "_graph_initialized": True,
            "graph_version": GRAPH_VERSION,
            "task_type": initial_state.get("task_type", ""),
            "candidate_email": initial_state.get("candidate_email"),
            "position_id": initial_state.get("position_id"),
            "input": initial_state.get("input", {}),
            "artifacts": initial_state.get("artifacts", {}),
            "completed_tools": initial_state.get("completed_tools", []),
            "events": initial_state.get("events", []),
            "agent_warnings": initial_state.get("agent_warnings", []),
            "supervisor_plan": initial_state.get("supervisor_plan", []),
            "supervisor_plan_reasons": initial_state.get("supervisor_plan_reasons", {}),
            "supervisor_plan_prepared": initial_state.get("supervisor_plan_prepared", False),
            "skipped_tools": initial_state.get("skipped_tools", []),
            "complete": False,
            "blocked": False,
        }

    def _guardrail_node(self, state: Dict[str, Any]) -> Generator[Dict[str, Any], None, None]:
        result = evaluate_guardrails(state.get("input", {}), state)
        state["guardrail"] = result.model_dump()
        if not result.safe:
            state["blocked"] = True
            state["complete"] = True
            yield self._event(state, "guardrail", "blocked", result.reason, {**result.model_dump(), "reason": result.reason})
            return
        yield self._event(state, "guardrail", "passed", "Input passed guardrail screening.", {**result.model_dump(), "reason": result.reason})

    def _prepare_supervisor_node(self, state: Dict[str, Any]) -> Generator[Dict[str, Any], None, None]:
        self._prepare_supervisor_plan(state)
        plan = state.get("supervisor_plan") or []
        reason = state.get("supervisor_plan_reason") or "Supervisor prepared the graph tool plan."
        yield self._event(
            state,
            "supervisor",
            "plan",
            "Supervisor prepared a single execution plan.",
            {
                "ordered_tools": plan,
                "reason": reason,
                "decision_reason": reason,
                "mode": settings.AGENT_SUPERVISOR_MODE,
            },
        )

    def _prepare_supervisor_plan(self, state: Dict[str, Any]) -> None:
        if state.get("supervisor_plan_prepared"):
            return
        allowed_tools = TASK_TOOL_PLANS.get(state.get("task_type"), [])
        use_llm = bool((state.get("input") or {}).get("supervisor_use_llm", True))
        fallback_reasons = {tool: self._fallback_tool_reason(state, tool) for tool in allowed_tools}
        state["supervisor_plan"] = list(allowed_tools)
        state["supervisor_plan_reasons"] = fallback_reasons
        state["supervisor_plan_reason"] = "Deterministic fallback plan keeps every required recruiting agent step involved."
        state["supervisor_plan_prepared"] = True

        if settings.AGENT_SUPERVISOR_MODE != "single_plan" or not use_llm:
            return
        client = get_openai_client()
        if not client:
            state.setdefault("agent_warnings", []).append("Supervisor LLM unavailable, so the deterministic single plan was used.")
            return
        try:
            response = client.chat.completions.create(
                model=settings.AGENT_SUPERVISOR_MODEL or settings.OPENAI_MODEL,
                temperature=0,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are the supervisor for an agentic recruiting graph. "
                            "Create one complete ordered tool plan for this session. "
                            "Keep every required recruiting agent step from allowed_tools; do not omit tools. "
                            "Return JSON only: {\"ordered_tools\":[{\"tool\":\"tool_name\",\"reason\":\"why this tool is needed now\"}],"
                            "\"reason\":\"overall plan reason\"}."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "task_type": state.get("task_type"),
                            "allowed_tools": allowed_tools,
                            "artifacts_available": sorted((state.get("artifacts") or {}).keys()),
                            "candidate_email": state.get("candidate_email"),
                            "position_id": state.get("position_id"),
                            "policy_hint": "send_agent_email can run only after plan_candidate_email and bounded action thresholds pass.",
                        }),
                    },
                ],
            )
            parsed = parse_llm_json(response.choices[0].message.content or "{}")
            ordered_tools, reasons = self._normalize_supervisor_plan(parsed, allowed_tools, fallback_reasons)
            state["supervisor_plan"] = ordered_tools
            state["supervisor_plan_reasons"] = reasons
            state["supervisor_plan_reason"] = str(parsed.get("reason") or "Supervisor planned the required graph tools in one LLM call.")
        except Exception as exc:
            warning = sanitize_provider_error(exc, "Supervisor single-plan LLM fell back to deterministic routing.")
            state.setdefault("agent_warnings", []).append(warning)

    def _normalize_supervisor_plan(
        self,
        parsed: Dict[str, Any],
        allowed_tools: List[str],
        fallback_reasons: Dict[str, str],
    ) -> tuple[List[str], Dict[str, str]]:
        ordered: List[str] = []
        reasons = dict(fallback_reasons)
        raw_items = parsed.get("ordered_tools") if isinstance(parsed, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        if not raw_items and parsed.get("next_tool"):
            raw_items = [{"tool": parsed.get("next_tool"), "reason": parsed.get("reason", "")}]
        for item in raw_items:
            if isinstance(item, dict):
                tool = str(item.get("tool") or item.get("name") or "").strip()
                reason = str(item.get("reason") or item.get("decision_reason") or "").strip()
            else:
                tool = str(item or "").strip()
                reason = ""
            if tool in allowed_tools and tool not in ordered:
                ordered.append(tool)
                if reason:
                    reasons[tool] = reason
        for tool in allowed_tools:
            if tool not in ordered:
                ordered.append(tool)
        return ordered, reasons

    def _supervisor_node(self, state: Dict[str, Any]) -> str:
        state["last_supervisor_decision"] = None
        state["last_supervisor_skip"] = None
        if settings.AGENT_SUPERVISOR_MODE == "single_plan":
            self._prepare_supervisor_plan(state)
            return self._next_tool_from_prepared_plan(state)
        if (state.get("input") or {}).get("supervisor_use_llm", True):
            llm_choice = self._llm_tool_choice(state)
            if llm_choice:
                return llm_choice
        plan = TASK_TOOL_PLANS.get(state.get("task_type"), [])
        completed = set(state.get("completed_tools") or [])
        for tool_name in plan:
            if tool_name == "send_agent_email" and not self._should_send_agent_email(state):
                continue
            if tool_name not in completed:
                reason = self._fallback_tool_reason(state, tool_name)
                state["last_supervisor_decision"] = {
                    "tool": tool_name,
                    "reason": reason,
                    "decision_reason": reason,
                }
                return tool_name
        return ""

    def _next_tool_from_prepared_plan(self, state: Dict[str, Any]) -> str:
        plan = state.get("supervisor_plan") or TASK_TOOL_PLANS.get(state.get("task_type"), [])
        reasons = state.get("supervisor_plan_reasons") or {}
        completed = set(state.get("completed_tools") or [])
        skipped = set(state.get("skipped_tools") or [])
        for tool_name in plan:
            if tool_name in completed or tool_name in skipped:
                continue
            if tool_name == "send_agent_email" and "plan_candidate_email" in plan and "plan_candidate_email" not in completed:
                continue
            if tool_name == "send_agent_email" and not self._should_send_agent_email(state):
                reason = self._email_skip_reason(state)
                state.setdefault("skipped_tools", []).append(tool_name)
                state["last_supervisor_skip"] = {
                    "tool": tool_name,
                    "reason": reason,
                    "decision_reason": reason,
                }
                continue
            reason = str(reasons.get(tool_name) or self._fallback_tool_reason(state, tool_name))
            state["last_supervisor_decision"] = {
                "tool": tool_name,
                "reason": reason,
                "decision_reason": reason,
            }
            return tool_name
        return ""

    def _llm_tool_choice(self, state: Dict[str, Any]) -> str:
        client = get_openai_client()
        if not client:
            return ""
        plan = TASK_TOOL_PLANS.get(state.get("task_type"), [])
        remaining = [tool for tool in plan if tool not in set(state.get("completed_tools") or [])]
        if not remaining:
            return ""
        if state.get("supervisor_plan"):
            for choice in state["supervisor_plan"]:
                if choice in remaining:
                    if choice == "send_agent_email" and "plan_candidate_email" in remaining:
                        continue
                    if choice == "send_agent_email" and not self._should_send_agent_email(state):
                        continue
                    reason = str((state.get("supervisor_plan_reasons") or {}).get(choice) or self._fallback_tool_reason(state, choice))
                    state["last_supervisor_decision"] = {"tool": choice, "reason": reason, "decision_reason": reason}
                    return choice
            return ""
        try:
            response = client.chat.completions.create(
                model=settings.AGENT_SUPERVISOR_MODEL or settings.OPENAI_MODEL,
                temperature=0,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are the supervisor for an agentic recruiting graph. "
                            "Choose the shortest ordered tool plan from the allowed_tools list. "
                            "Use every required recruiting agent step, but avoid redundant work. "
                            "Return JSON only: {\"ordered_tools\":[\"tool_name\"],\"reason\":\"short reason\"}. "
                            "If you cannot plan, return {\"next_tool\":\"tool_name\",\"reason\":\"short reason\"}."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "task_type": state.get("task_type"),
                            "allowed_tools": remaining,
                            "completed_tools": state.get("completed_tools"),
                            "artifacts_available": sorted((state.get("artifacts") or {}).keys()),
                            "policy_hint": "Skip send_agent_email unless bounded autonomy thresholds are satisfied.",
                        }),
                    },
                ],
            )
            parsed = parse_llm_json(response.choices[0].message.content or "{}")
            ordered_tools = [
                str(tool).strip()
                for tool in parsed.get("ordered_tools", [])
                if str(tool).strip() in remaining
            ] if isinstance(parsed.get("ordered_tools"), list) else []
            if ordered_tools:
                state["supervisor_plan"] = ordered_tools
                for choice in ordered_tools:
                    if choice == "send_agent_email" and "plan_candidate_email" in remaining:
                        continue
                    if choice == "send_agent_email" and not self._should_send_agent_email(state):
                        continue
                    reason = str(parsed.get("reason") or self._fallback_tool_reason(state, choice))
                    state["last_supervisor_decision"] = {"tool": choice, "reason": reason, "decision_reason": reason}
                    return choice
            choice = str(parsed.get("next_tool") or "").strip()
            if choice in remaining:
                if choice == "send_agent_email" and "plan_candidate_email" in remaining:
                    reason = "Email sending must wait until the Email Planning Agent decides whether outreach is allowed."
                    state["last_supervisor_decision"] = {"tool": "plan_candidate_email", "reason": reason, "decision_reason": reason}
                    return "plan_candidate_email"
                if choice == "send_agent_email" and not self._should_send_agent_email(state):
                    return ""
                reason = str(parsed.get("reason") or self._fallback_tool_reason(state, choice))
                state["last_supervisor_decision"] = {"tool": choice, "reason": reason, "decision_reason": reason}
                return choice
        except Exception as exc:
            warning = sanitize_provider_error(exc, "Supervisor LLM routing fell back to deterministic routing.")
            state["agent_warnings"].append(warning)
        return ""

    def _tool_node(self, state: Dict[str, Any], tool_name: str) -> Generator[Dict[str, Any], None, None]:
        args = self._build_tool_args(state, tool_name)
        start_reason = self._current_tool_reason(state, tool_name)
        yield self._event(
            state,
            "tool",
            "started",
            f"Calling {tool_name}.",
            {"tool": tool_name, "reason": start_reason, "decision_reason": start_reason},
        )
        try:
            result = self._call_tool_with_timeout(tool_name, args, state)
            state.setdefault("completed_tools", []).append(tool_name)
            self._store_tool_result(state, tool_name, result)
            complete_reason = self._tool_result_reason(tool_name, result, state)
            yield self._event(
                state,
                "tool",
                "completed",
                f"{tool_name} completed.",
                {
                    "tool": tool_name,
                    "result": self._safe_event_payload(result),
                    "reason": complete_reason,
                    "decision_reason": complete_reason,
                },
            )
        except Exception as exc:
            warning = sanitize_provider_error(exc, f"{tool_name} failed and the graph continued with fallback handling.")
            state.setdefault("agent_warnings", []).append(warning)
            state.setdefault("completed_tools", []).append(tool_name)
            reason = warning
            yield self._event(state, "tool", "failed", warning, {"tool": tool_name, "reason": reason, "decision_reason": reason})

    def _call_tool_with_timeout(self, tool_name: str, args: Dict[str, Any], state: Dict[str, Any]) -> Any:
        timeout_seconds = max(1.0, float(settings.AGENT_WORKER_TIMEOUT_SECONDS or 20.0))
        future = AGENT_TOOL_EXECUTOR.submit(call_tool, tool_name, args, dict(state))
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeoutError as exc:
            future.cancel()
            raise TimeoutError(f"{tool_name} exceeded the {timeout_seconds:.0f}s agent worker timeout.") from exc

    def _current_tool_reason(self, state: Dict[str, Any], tool_name: str) -> str:
        decision = state.get("last_supervisor_decision") or {}
        return str(decision.get("reason") or (state.get("supervisor_plan_reasons") or {}).get(tool_name) or self._fallback_tool_reason(state, tool_name))

    def _fallback_tool_reason(self, state: Dict[str, Any], tool_name: str) -> str:
        task_type = state.get("task_type") or "recruiting task"
        reasons = {
            "build_requirements": "Requirement Agent must convert hiring input into structured role requirements before downstream scoring.",
            "parse_resume": "Resume Agent must standardize candidate information before matching or profile persistence.",
            "analyze_bias": "Bias Agent must inspect and neutralize pedigree signals before role-fit scoring.",
            "match_candidate": "Matching Agent must compare candidate evidence with current job requirements before screening decisions.",
            "generate_screening_questions": "Interview Agent Phase A must create role-specific questions from match gaps and requirements.",
            "evaluate_screening_answers": "Interview Agent Phase B must score the candidate's exact answers against the exact questions and role requirements.",
            "generate_report": "Report Agent must summarize candidate evidence, outreach context, and development guidance.",
            "create_or_update_application": "Persistence Agent must create or update the Supabase application record after matching and question generation.",
            "save_screening_evaluation": "Persistence Agent must save the screening evaluation so HR and candidate views share the same evidence.",
            "update_application_status": "Action Policy Agent must update status only after evaluation evidence and bounded-action rules are available.",
            "plan_candidate_email": "Email Planning Agent must decide whether a candidate-facing email is appropriate before SMTP delivery is attempted.",
            "send_agent_email": "Email Tool can send only after the planner and bounded action policy approve candidate-facing outreach.",
            "stage_sourced_candidate": "Sourcing Agent must stage the candidate and application after matching, questions, and report artifacts are ready.",
            "upsert_candidate_profile": "Persistence Agent must store the standardized candidate profile in Supabase.",
        }
        return reasons.get(tool_name, f"{tool_name} is required by the {task_type} graph plan.")

    def _tool_result_reason(self, tool_name: str, result: Any, state: Dict[str, Any]) -> str:
        if isinstance(result, dict):
            policy = result.get("policy") if isinstance(result.get("policy"), dict) else {}
            if policy.get("reason"):
                return str(policy["reason"])
            if result.get("decision_reason"):
                return str(result["decision_reason"])
            if result.get("reason"):
                return str(result["reason"])
        if tool_name == "parse_resume" and isinstance(result, dict):
            return f"Resume Agent extracted profile fields for {result.get('name') or 'the candidate'} with {len(result.get('skills') or [])} detected skills."
        if tool_name == "analyze_bias":
            return "Bias Agent completed pedigree and protected-signal review before scoring."
        if tool_name == "match_candidate" and isinstance(result, dict):
            scores = result.get("scores", {}) if isinstance(result.get("scores"), dict) else {}
            score = scores.get("overall_position_fit") or scores.get("technical") or 0
            return str(result.get("score_explanation") or result.get("position_fit_summary") or f"Matching Agent calculated a position-fit score of {score}.")
        if tool_name == "generate_screening_questions" and isinstance(result, list):
            return f"Interview Agent generated {len(result)} role-specific screening questions."
        if tool_name == "evaluate_screening_answers" and isinstance(result, dict):
            return str(result.get("decision_reason") or f"Interview Agent assigned screening score {result.get('screening_score')} with recommendation {result.get('hiring_recommendation')}.")
        if tool_name == "generate_report":
            return "Report Agent produced candidate summary artifacts for HR review and outreach."
        if tool_name in {"create_or_update_application", "save_screening_evaluation", "update_application_status", "stage_sourced_candidate"} and isinstance(result, dict):
            return f"{tool_name} wrote an action receipt with status {result.get('status') or result.get('ok')}."
        if tool_name == "plan_candidate_email" and isinstance(result, dict):
            return str(result.get("reason") or f"Email planner chose should_send={result.get('should_send')}.")
        if tool_name == "send_agent_email" and isinstance(result, dict):
            return f"Email action completed with sent={result.get('sent')} after policy review."
        return self._fallback_tool_reason(state, tool_name)

    def _email_skip_reason(self, state: Dict[str, Any]) -> str:
        email_plan = (state.get("artifacts") or {}).get("email_plan")
        if isinstance(email_plan, dict) and email_plan.get("reason"):
            return f"Email was skipped because the Email Planning Agent decided not to send: {email_plan.get('reason')}"
        return "Email was skipped because bounded autonomy thresholds or SMTP/action-policy requirements were not satisfied."

    def _build_tool_args(self, state: Dict[str, Any], tool_name: str) -> Dict[str, Any]:
        input_data = state.get("input") or {}
        artifacts = state.get("artifacts") or {}
        if tool_name == "parse_resume":
            return {
                "resume_text": input_data.get("resume_text", ""),
                "prestige_neutralize": False,
                "use_llm": bool(input_data.get("resume_use_llm", True)),
            }
        if tool_name == "build_requirements":
            return {
                "job_title": input_data.get("job_title") or input_data.get("title", ""),
                "department": input_data.get("department", ""),
                "job_description": input_data.get("job_description") or input_data.get("description", ""),
                "chat_messages": input_data.get("chat_messages"),
            }
        if tool_name == "analyze_bias":
            return {
                "candidate_profile": artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {},
                "resume_text": input_data.get("resume_text", ""),
                "use_llm": bool(input_data.get("bias_use_llm", True)),
            }
        if tool_name == "match_candidate":
            return {
                "job_requirements": input_data.get("job_requirements") or input_data.get("job") or {},
                "candidate_profile": artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {},
                "prestige_analysis": artifacts.get("prestige_analysis"),
            }
        if tool_name == "generate_screening_questions":
            return {
                "candidate_profile": artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {},
                "match_results": artifacts.get("match_results") or input_data.get("match_results") or {},
                "job_requirements": input_data.get("job_requirements") or input_data.get("job") or {},
            }
        if tool_name == "evaluate_screening_answers":
            return {
                "questions": input_data.get("questions") or input_data.get("custom_questions") or [],
                "answers": input_data.get("answers") or [],
                "job_requirements": input_data.get("job_requirements") or input_data.get("job") or {},
            }
        if tool_name == "generate_report":
            return {
                "candidate_profile": artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {},
                "match_results": artifacts.get("match_results") or input_data.get("match_results") or {},
                "job_requirements": input_data.get("job_requirements") or input_data.get("job") or {},
            }
        if tool_name == "create_or_update_application":
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "status": input_data.get("status") or "applied",
                "match_results": artifacts.get("match_results") or input_data.get("match_results"),
                "custom_questions": artifacts.get("custom_questions") or input_data.get("custom_questions"),
                "sourcing_pitch": artifacts.get("report", {}).get("sourcing_pitch") or input_data.get("sourcing_pitch"),
                "outreach_email": artifacts.get("report", {}).get("outreach_email") or input_data.get("outreach_email"),
            }
        if tool_name == "stage_sourced_candidate":
            profile = artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {}
            return {
                "candidate_email": state.get("candidate_email") or profile.get("email"),
                "email": state.get("candidate_email") or profile.get("email"),
                "name": profile.get("name", ""),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "profile_data": profile,
                "source_method": input_data.get("source_method") or profile.get("source_method") or "agent_graph",
                "match_results": artifacts.get("match_results") or {},
                "custom_questions": artifacts.get("custom_questions") or [],
                "sourcing_pitch": artifacts.get("report", {}).get("sourcing_pitch", ""),
                "outreach_email": artifacts.get("report", {}).get("outreach_email", ""),
            }
        if tool_name == "save_screening_evaluation":
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "answers": input_data.get("answers") or [],
                "evaluation": artifacts.get("evaluation") or {},
            }
        if tool_name == "update_application_status":
            evaluation = artifacts.get("evaluation") or {}
            next_status = input_data.get("next_status") or (
                "rejected" if state.get("task_type") == "sandbox_evaluation" and self._should_send_agent_email(state) else "screening"
            )
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "status": next_status,
                "screening_score": evaluation.get("screening_score"),
                "hiring_recommendation": evaluation.get("hiring_recommendation"),
            }
        if tool_name == "send_agent_email":
            return self._build_email_args(state)
        if tool_name == "plan_candidate_email":
            evaluation = artifacts.get("evaluation") or {}
            match_results = artifacts.get("match_results") or input_data.get("match_results") or {}
            scores = match_results.get("scores", {}) if isinstance(match_results, dict) else {}
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "to_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "candidate_profile": artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {},
                "job_requirements": input_data.get("job_requirements") or input_data.get("job") or {},
                "match_results": match_results,
                "evaluation": evaluation,
                "report": artifacts.get("report") or {},
                "application_status": input_data.get("status") or "",
                "overall_position_fit": state.get("overall_position_fit") or scores.get("overall_position_fit"),
                "screening_score": state.get("screening_score") or evaluation.get("screening_score"),
                "hiring_recommendation": state.get("hiring_recommendation") or evaluation.get("hiring_recommendation"),
            }
        if tool_name == "upsert_candidate_profile":
            profile = artifacts.get("candidate_profile") or input_data.get("candidate_profile") or input_data.get("profile_data") or {}
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email") or profile.get("email"),
                "email": state.get("candidate_email") or input_data.get("candidate_email") or profile.get("email"),
                "name": profile.get("name", ""),
                "profile_data": profile,
                "resume_text": input_data.get("resume_text", ""),
                "status": input_data.get("status") or "profile",
                "source_type": input_data.get("source_type") or "inbound",
                "source_method": input_data.get("source_method") or "resume_agent_graph",
            }
        return {}

    def _store_tool_result(self, state: Dict[str, Any], tool_name: str, result: Any) -> None:
        artifacts = state.setdefault("artifacts", {})
        if isinstance(result, dict) and result.get("agent_warnings"):
            state.setdefault("agent_warnings", []).extend(
                str(warning) for warning in result.get("agent_warnings", []) if warning
            )
        if tool_name == "parse_resume":
            artifacts["candidate_profile"] = result
        elif tool_name == "build_requirements":
            artifacts["requirements"] = result
            state["complete"] = True
        elif tool_name == "analyze_bias":
            artifacts["prestige_analysis"] = result
        elif tool_name == "match_candidate":
            artifacts["match_results"] = result
            scores = result.get("scores", {}) if isinstance(result, dict) else {}
            state["overall_position_fit"] = scores.get("overall_position_fit")
        elif tool_name == "generate_screening_questions":
            artifacts["custom_questions"] = result
        elif tool_name == "evaluate_screening_answers":
            artifacts["evaluation"] = result
            state["screening_score"] = result.get("screening_score") if isinstance(result, dict) else None
            state["hiring_recommendation"] = result.get("hiring_recommendation") if isinstance(result, dict) else None
        elif tool_name == "generate_report":
            artifacts["report"] = result
        elif tool_name == "plan_candidate_email":
            artifacts["email_plan"] = result
            artifacts.setdefault("action_receipts", []).append({"tool": tool_name, "result": result})
            if self._all_required_non_email_tools_done(state):
                state["complete"] = False
        elif tool_name in {"create_or_update_application", "stage_sourced_candidate", "save_screening_evaluation", "update_application_status", "send_agent_email"}:
            artifacts.setdefault("action_receipts", []).append({"tool": tool_name, "result": result})
            if tool_name != "send_agent_email" and self._all_required_non_email_tools_done(state):
                state["complete"] = not self._should_send_agent_email(state)
            if tool_name == "send_agent_email":
                state["complete"] = True

    def _should_send_agent_email(self, state: Dict[str, Any]) -> bool:
        email_plan = (state.get("artifacts") or {}).get("email_plan")
        if isinstance(email_plan, dict) and "should_send" in email_plan:
            return bool(email_plan.get("should_send"))
        task_type = state.get("task_type")
        if task_type == "sourced_candidate":
            score = int(state.get("overall_position_fit") or 0)
            return score >= settings.AGENT_INVITE_MIN_FIT_SCORE
        if task_type == "sandbox_evaluation":
            score = int(state.get("screening_score") or 0)
            recommendation = str(state.get("hiring_recommendation") or "").lower()
            return score <= settings.AGENT_REJECT_MAX_SCREENING_SCORE and recommendation == "reject"
        return False

    def _build_email_args(self, state: Dict[str, Any]) -> Dict[str, Any]:
        input_data = state.get("input") or {}
        artifacts = state.get("artifacts", {}) or {}
        report = artifacts.get("report") or {}
        email_plan = artifacts.get("email_plan") if isinstance(artifacts.get("email_plan"), dict) else {}
        task_type = state.get("task_type")
        if email_plan:
            return {
                **email_plan,
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "to_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "overall_position_fit": state.get("overall_position_fit") or email_plan.get("overall_position_fit"),
                "screening_score": state.get("screening_score") or email_plan.get("screening_score"),
                "hiring_recommendation": state.get("hiring_recommendation") or email_plan.get("hiring_recommendation"),
            }
        if task_type == "sandbox_evaluation":
            return {
                "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "to_email": state.get("candidate_email") or input_data.get("candidate_email"),
                "position_id": state.get("position_id") or input_data.get("position_id"),
                "subject": "Application update",
                "body": input_data.get("rejection_message") or "Thank you for completing the screening. Based on the current evaluation, we will not be moving forward for this position.",
                "action_type": "reject",
                "screening_score": state.get("screening_score"),
                "hiring_recommendation": state.get("hiring_recommendation"),
            }
        return {
            "candidate_email": state.get("candidate_email") or input_data.get("candidate_email"),
            "to_email": state.get("candidate_email") or input_data.get("candidate_email"),
            "position_id": state.get("position_id") or input_data.get("position_id"),
            "subject": input_data.get("email_subject") or "Invitation to continue your application",
            "body": report.get("outreach_email") or input_data.get("outreach_email") or "We would like to invite you to continue in the candidate portal.",
            "action_type": "invite",
            "overall_position_fit": state.get("overall_position_fit"),
        }

    def _all_required_non_email_tools_done(self, state: Dict[str, Any]) -> bool:
        plan = [tool for tool in TASK_TOOL_PLANS.get(state.get("task_type"), []) if tool != "send_agent_email"]
        completed = set(state.get("completed_tools") or [])
        return all(tool in completed for tool in plan)

    def _event(
        self,
        state: Dict[str, Any],
        node: str,
        event_type: str,
        message: str,
        payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        payload = payload or {}
        reason = str(payload.get("reason") or payload.get("decision_reason") or "").strip()
        if settings.AGENT_DECISION_REASONS and reason:
            payload.setdefault("reason", reason)
            payload.setdefault("decision_reason", reason)
        event = {
            "graph_version": GRAPH_VERSION,
            "event_type": event_type,
            "node": node,
            "message": message,
            "reason": reason,
            "decision_reason": reason,
            "candidate_email": state.get("candidate_email"),
            "position_id": state.get("position_id"),
            "payload": payload,
        }
        state.setdefault("events", []).append(event)
        try:
            record_agent_event(event)
        except Exception as exc:
            state.setdefault("agent_warnings", []).append(f"Agent event logging failed: {exc}")
        return event

    def _final_event(self, state: Dict[str, Any]) -> Dict[str, Any]:
        return self._event(
            state,
            "graph",
            "final",
            "Agent graph completed." if not state.get("blocked") else "Agent graph stopped by guardrails.",
            {
                "blocked": state.get("blocked", False),
                "completed_tools": state.get("completed_tools", []),
                "artifacts": sorted((state.get("artifacts") or {}).keys()),
                "warnings": state.get("agent_warnings", []),
                "reason": "All required graph tools completed or were safely skipped by policy.",
                "decision_reason": "All required graph tools completed or were safely skipped by policy.",
            },
        )

    def _safe_event_payload(self, value: Any) -> Any:
        if isinstance(value, dict):
            safe = {}
            for key, item in value.items():
                if key in {"resume_text", "password_hash", "SMTP_PASSWORD"}:
                    safe[key] = "[redacted]"
                elif isinstance(item, (dict, list, str, int, float, bool)) or item is None:
                    safe[key] = item
            return safe
        if isinstance(value, list):
            return value[:5]
        return value


recruiting_agent_graph = RecruitingAgentGraph()


def build_langgraph_app() -> Any:
    """Build a minimal LangGraph app exposing the production graph nodes.

    The API routes use RecruitingAgentGraph directly so existing streaming and
    fallback behavior stays stable. This builder gives the project a concrete
    LangGraph artifact for architecture review, tracing experiments, and future
    migration to native LangGraph execution.
    """
    if StateGraph is None or END is None:
        raise RuntimeError("langgraph is not installed. Run pip install -r backend/requirements.txt.")

    def guardrail_node(state: Dict[str, Any]) -> Dict[str, Any]:
        list(recruiting_agent_graph._guardrail_node(state))
        return state

    def supervisor_node(state: Dict[str, Any]) -> Dict[str, Any]:
        state["next_tool"] = recruiting_agent_graph._supervisor_node(state)
        return state

    def tool_node(state: Dict[str, Any]) -> Dict[str, Any]:
        next_tool = state.get("next_tool")
        if next_tool:
            list(recruiting_agent_graph._tool_node(state, next_tool))
        return state

    def route_after_guardrail(state: Dict[str, Any]) -> str:
        return END if state.get("blocked") else "supervisor_node"

    def route_after_supervisor(state: Dict[str, Any]) -> str:
        return "tool_node" if state.get("next_tool") else END

    workflow = StateGraph(dict)
    workflow.add_node("guardrail_node", guardrail_node)
    workflow.add_node("supervisor_node", supervisor_node)
    workflow.add_node("tool_node", tool_node)
    workflow.set_entry_point("guardrail_node")
    workflow.add_conditional_edges("guardrail_node", route_after_guardrail)
    workflow.add_conditional_edges("supervisor_node", route_after_supervisor)
    workflow.add_edge("tool_node", "supervisor_node")
    return workflow.compile()


def run_agent_graph(task_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return recruiting_agent_graph.run({"task_type": task_type, **payload})


def stream_agent_graph(task_type: str, payload: Dict[str, Any]) -> Generator[Dict[str, Any], None, Dict[str, Any]]:
    state = {"task_type": task_type, **payload}
    yield from recruiting_agent_graph.stream(state)
