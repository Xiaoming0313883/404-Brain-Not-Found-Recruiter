import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as Progress from '@radix-ui/react-progress';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateData } from '../CandidatePortal';
import { API_BASE_URL } from '../../api';
import { AgentActivityEvent, AgentActivityFeed } from './AgentActivityFeed';
import { KnowledgeTooltip } from '../KnowledgeTooltip';

interface Props {
  candidateData: CandidateData;
  onUpdateCandidate: (data: CandidateData) => void;
}

export function CandidateApplyLoading({ candidateData, onUpdateCandidate }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const position = (location.state as any)?.position;
  const [progress, setProgress] = useState(8);
  const [message, setMessage] = useState('Starting application...');
  const [agentEvents, setAgentEvents] = useState<AgentActivityEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (startedRef.current) return;
    startedRef.current = true;
    if (!position?.id) {
      navigate('/candidate/home', { replace: true });
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setAgentEvents([]);
        const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/apply-position/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position_id: position.id })
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.detail || 'Failed to apply for this position.');
        }
        if (!response.body) {
          throw new Error('Application agent did not return a progress stream.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let data: any = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            const raw = frame
              .split('\n')
              .filter(line => line.startsWith('data:'))
              .map(line => line.replace(/^data:\s?/, ''))
              .join('\n');
            if (!raw) continue;
            const payload = JSON.parse(raw);
            if (payload.progress && !cancelled) {
              setProgress(Math.max(5, Math.min(100, payload.progress)));
            }
            if (payload.agent_event && !cancelled) {
              setAgentEvents(events => [...events, payload.agent_event]);
              if (payload.agent_event.message) setMessage(payload.agent_event.message);
            }
            if (payload.error) {
              throw new Error(payload.error);
            }
            if (payload.result) {
              data = payload.result;
            }
          }
        }

        if (!data) {
          throw new Error('Application agent completed without returning a candidate result.');
        }
        const normalizedApplications = (data.applications || []).map((application: any) => ({
          ...application,
          status: application.status === 'invited' || application.status === 'staged' ? 'sourced' : application.status,
          progress: application.progress ?? 40
        }));
        const selectedApplication = normalizedApplications.find((application: any) => application.position_id === position.id);
        const prefilledAnswers = data.answers?.length
          ? data.answers
          : selectedApplication?.draft_answers?.length
            ? selectedApplication.draft_answers
            : [];
        onUpdateCandidate({
          ...candidateData,
          jobId: position.id,
          selectedApplicationId: data.application_id || selectedApplication?.application_id,
          position: position.title,
          status: 'applied',
          progress: 40,
          applications: normalizedApplications,
          customQuestions: data.custom_questions,
          sandboxAnswers: prefilledAnswers,
          evaluation: data.evaluation,
          agentWarnings: data.agent_warnings || candidateData.agentWarnings || [],
          notifications: data.notifications || candidateData.notifications || []
        });
        setProgress(100);
        setMessage('Interview workspace ready.');
        toast.success('Application registered. Interview workspace ready.');
        window.setTimeout(() => navigate('/candidate/sandbox'), 400);
      } catch (error: any) {
        const message = error.message || 'Application setup failed.';
        setErrorMessage(message);
        toast.error(message);
        setMessage('Application setup stopped.');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [candidateData, navigate, onUpdateCandidate, position]);

  return (
    <div className="min-h-screen bg-[#f7f6f3] px-6 py-16">
      <div className="max-w-2xl mx-auto bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-[#e8f2ee] flex items-center justify-center mb-5">
          {errorMessage ? <Bot className="w-6 h-6 text-[#b91c1c]" /> : <Loader2 className="w-6 h-6 text-[#2d6a55] animate-spin" />}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] font-semibold">Application Progress</p>
          <KnowledgeTooltip label="What application progress means">
            Progress is streamed from the recruiting agent graph as guardrail, supervisor, matching, interview-question, and persistence tools complete.
          </KnowledgeTooltip>
        </div>
        <h1 className="text-2xl text-[#1c1c1a] font-semibold mb-2">{position?.title || 'Selected position'}</h1>
        <p className="text-sm text-[#6b7063] mb-6">{message}</p>
        <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-2 w-full">
          <Progress.Indicator className="bg-[#2d6a55] h-full transition-transform duration-500" style={{ transform: `translateX(-${100 - progress}%)`, width: '100%' }} />
        </Progress.Root>
        <p className="text-xs text-[#2d6a55] font-semibold mt-3">{progress}%</p>
        <div className="mt-6">
          <AgentActivityFeed events={agentEvents} currentMessage={message} progress={progress} title="Application Agent Trace" />
        </div>
        {errorMessage && (
          <div className="mt-6 rounded-xl border border-[#f5c2c2] bg-[#fdf2f2] p-4 text-sm text-[#b91c1c]">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
