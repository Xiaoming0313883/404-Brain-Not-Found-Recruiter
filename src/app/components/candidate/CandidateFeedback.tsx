import { Link } from 'react-router';
import { CandidateData } from '../CandidatePortal';
import * as Progress from '@radix-ui/react-progress';
import { ArrowLeft, BookOpen, Calendar, CheckCircle2, TrendingUp, Target } from 'lucide-react';
import { CandidateNav } from './CandidateNav';
import { KnowledgeTooltip } from '../KnowledgeTooltip';

interface Props {
  candidateData: CandidateData;
  onSignOut?: () => void;
}

const alignScoreMentions = (text: string, score: any) => {
  if (score === undefined || score === null || text === undefined || text === null) return text;
  return String(text)
    .replace(/(answer\s+scored\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(score\s+is\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(scored\s+)(\d+(?:\.\d+)?)(\s*out\s+of\s+100)/i, `$1${score}$3`);
};

export const cleanQuestionText = (text: string, index?: number): string => {
  if (!text) return '';
  const trimmed = text.trim();
  
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        if (index !== undefined && index >= 0 && index < parsed.length) {
          return String(parsed[index]).trim();
        }
        return parsed.join(' ').trim();
      }
      if (typeof parsed === 'object') {
        const qList = parsed.questions || parsed.custom_questions || parsed.screening_questions || parsed.items;
        if (Array.isArray(qList)) {
          if (index !== undefined && index >= 0 && index < qList.length) {
            return String(qList[index]).trim();
          }
          return qList.join(' ').trim();
        }
        const stringValues = Object.values(parsed).filter(v => typeof v === 'string');
        if (index !== undefined && index >= 0 && index < stringValues.length) {
          return String(stringValues[index]).trim();
        }
        return stringValues.join(' ').trim();
      }
    } catch (e) {
      // ignore
    }
  }
  
  if (trimmed.includes('"questions"') || trimmed.includes('"custom_questions"')) {
    const match = trimmed.match(/"(?:questions|custom_questions)"\s*:\s*\[([\s\S]*?)\]/);
    if (match && match[1]) {
      const items = match[1].split(/",\s*"/).map(s => s.replace(/"/g, '').trim());
      if (index !== undefined && index >= 0 && index < items.length) {
        return items[index];
      }
      return items.join(' ');
    }
  }
  
  let cleaned = trimmed
    .replace(/^"/, '')
    .replace(/"$/, '');
    
  return cleaned.trim();
};

export function CandidateFeedback({ candidateData, onSignOut }: Props) {
  const applications = candidateData.applications || [];
  const selectedApplication = applications.find(application => application.application_id === candidateData.selectedApplicationId)
    || applications.find(application => application.position_id === candidateData.jobId)
    || applications[applications.length - 1];
  const activeStatus = selectedApplication?.status || candidateData.status;
  const evaluation = selectedApplication?.evaluation || candidateData.evaluation;
  const score = evaluation?.screening_score ?? candidateData.score ?? 0;
  const isHighScore = score >= 70;
  const scoreBreakdown = evaluation?.score_breakdown;
  const hrFeedback = selectedApplication?.hr_feedback || candidateData.hrFeedback || '';
  const rejectionMessage = selectedApplication?.rejection_message || candidateData.rejectionMessage || '';
  const interviewSlot = selectedApplication?.interview_slot || candidateData.interviewSlot;
  const hasResults = Boolean(
    selectedApplication &&
    (evaluation || hrFeedback || rejectionMessage || interviewSlot || ['screening', 'completed', 'hired', 'rejected', 'interview_scheduled'].includes(activeStatus))
  );

  // Retrieve dynamically generated AI upskilling roadmap from evaluation details
  const rawRoadmap = evaluation?.upskilling_roadmap || {};
  const roadmap = [
    {
      week: 1,
      title: 'Week 1 Focus & Core Competencies',
      tasks: rawRoadmap.week_1 ? [rawRoadmap.week_1] : [
        'Read "Designing Data-Intensive Applications" chapters 5–7',
        'Complete MIT 6.824 lectures on consensus algorithms',
        'Build a simple key-value store with Raft consensus'
      ]
    },
    {
      week: 2,
      title: 'Week 2 Migration Patterns & Integrity',
      tasks: rawRoadmap.week_2 ? [rawRoadmap.week_2] : [
        'Study saga patterns for distributed transactions',
        'Implement circuit breaker patterns in a sample service',
        'Practice API gateway design with rate limiting'
      ]
    },
    {
      week: 3,
      title: 'Week 3 Observability & High Performance',
      tasks: rawRoadmap.week_3 ? [rawRoadmap.week_3] : [
        'Set up monitoring with Prometheus & Grafana',
        'Implement distributed tracing with OpenTelemetry',
        'Practice incident response with chaos engineering tools'
      ]
    }
  ];

  const rawCritiques = evaluation?.question_feedback || evaluation?.critiques || [];
  const critiqueCounts = rawCritiques.reduce((counts: Record<string, number>, item: any) => {
    const key = String(item?.critique || '').trim().toLowerCase();
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const critiques = rawCritiques.map((item: any, index: number) => {
    const answer = item.candidate_answer || selectedApplication?.answers?.[index] || candidateData.sandboxAnswers?.[index] || item.candidate_answer_excerpt || '';
    const duplicated = critiqueCounts[String(item?.critique || '').trim().toLowerCase()] > 1;
    if (!duplicated || !answer) {
      return {
        ...item,
        critique: alignScoreMentions(item.critique, item.per_answer_score)
      };
    }
    return {
      ...item,
      candidate_answer: item.candidate_answer || answer,
      candidate_answer_excerpt: item.candidate_answer_excerpt || answer,
      critique: `${alignScoreMentions(item.critique, item.per_answer_score)} For this specific answer, the evaluator reviewed the candidate's full answer: "${String(answer)}"`
    };
  });

  if (!hasResults) {
    return (
      <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
        <div className="max-w-3xl mx-auto">
          <CandidateNav onSignOut={onSignOut} />
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 text-center shadow-sm">
            <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4 font-semibold">Results</p>
            <h1 className="text-[#1c1c1a] mb-2 font-semibold text-2xl">No results yet</h1>
            <p className="text-sm text-[#6b7063] max-w-md mx-auto leading-relaxed">
              Choose an application with completed screening, feedback, or an interview decision to review results here.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/candidate/applications" className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm font-medium">
                View Applications
              </Link>
              <Link to="/candidate/jobs" className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] transition-colors text-sm font-medium">
                Browse Jobs
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
      <div className="max-w-3xl mx-auto">
        <CandidateNav onSignOut={onSignOut} />

        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4 font-semibold">Assessment Complete</p>
          <h1 className="text-[#1c1c1a] mb-2 font-semibold text-3xl">Your Results</h1>
          <p className="text-sm text-[#6b7063]">
            Thank you for completing the warm-up sandbox, {candidateData.name}
          </p>
        </div>

        {/* Progress */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-5 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#6b7063] uppercase tracking-wider font-semibold">Application Progress</span>
            <span className="text-xs text-[#2d6a55] font-semibold">Screening Completed</span>
          </div>
          <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-1.5 w-full">
            <Progress.Indicator
              className="bg-[#2d6a55] h-full"
              style={{ transform: 'translateX(0%)', width: '100%' }}
            />
          </Progress.Root>
        </div>

        {/* Score Card */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 mb-5 text-center shadow-sm">
          <div className={`inline-flex items-center justify-center w-24 h-24 rounded-2xl mb-4 ${
            isHighScore ? 'bg-[#e8f2ee]' : 'bg-[#f0ede8]'
          }`}>
            <span className={`text-4xl font-semibold ${isHighScore ? 'text-[#2d6a55]' : 'text-[#6b7063]'}`}>
              {score}
            </span>
          </div>
          <div className="mb-1">
            <h2 className="text-[#1c1c1a] text-xl font-semibold">
              {isHighScore ? 'Outstanding Performance' : 'Solid Effort'}
            </h2>
          </div>
          <p className="text-sm text-[#6b7063] max-w-md mx-auto leading-relaxed">
            {evaluation?.role_alignment_summary || rejectionMessage || (
              isHighScore
                ? 'Your responses demonstrate strong current-position alignment and practical problem-solving ability. The hiring team will be reviewing your profile shortly.'
                : "Your responses show some relevant thinking for this position. We've prepared a personalized development roadmap to support your growth."
            )}
          </p>
          {evaluation?.decision_reason && (
            <p className="mt-3 rounded-xl border border-[#e4e1da] bg-white px-4 py-3 text-xs leading-relaxed text-[#52574e] shadow-sm">
              <span className="font-semibold text-[#1c1c1a]">Decision reason:</span> {evaluation.decision_reason}
            </p>
          )}
        </div>

        {scoreBreakdown && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[#1c1c1a] font-semibold text-base">Position-Focused Score Breakdown</h3>
                  <KnowledgeTooltip label="What the screening score means">
                    The score is a 100-point rubric: role alignment, technical depth, evidence, role impact, and communication clarity. It is based on your answers to the current position's questions.
                  </KnowledgeTooltip>
                </div>
                <p className="text-xs text-[#6b7063]">{evaluation?.position_fit_verdict || 'Marked against the current position requirements'}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-5 gap-2">
              {[
                ['Role', scoreBreakdown.role_requirement_alignment, 35],
                ['Depth', scoreBreakdown.technical_correctness_depth, 25],
                ['Evidence', scoreBreakdown.evidence_specificity, 20],
                ['Impact', scoreBreakdown.position_impact, 10],
                ['Clarity', scoreBreakdown.communication_clarity, 10]
              ].map(([label, value, max]) => (
                <div key={label} className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-3 text-center">
                  <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">{label}</p>
                  <p className="text-sm text-[#1c1c1a] font-semibold mt-1">{value || 0}/{max}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Qualitative Critique from AI Agent */}
        {critiques && critiques.length > 0 ? (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[#1c1c1a] font-semibold text-base">Interview Session</h3>
                  <KnowledgeTooltip label="How feedback is generated">
                    The Interview Agent compares each answer with the exact question and role requirements, then gives evidence-based strengths, weaknesses, suggested improvement, and a hiring-manager note.
                  </KnowledgeTooltip>
                </div>
                <p className="text-xs text-[#6b7063]">Detailed transcript and critique from your interview session</p>
              </div>
            </div>

            <div className="space-y-6">
              {critiques.map((item: any, idx: number) => (
                <div key={idx} className="bg-white border border-[#e4e1da] rounded-xl p-5 shadow-sm space-y-4 text-left">
                  <div className="flex items-center justify-between border-b border-[#e4e1da] pb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#2d6a55]">
                      Question {idx + 1}
                    </span>
                    {item.per_answer_score !== undefined && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#e8f2ee] text-[#2d6a55] border border-[#c8e6d8]">
                        Score: {item.per_answer_score}/100
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase text-[#a8a49d]">Question</p>
                    <p className="text-sm text-[#1c1c1a] font-medium italic">"{cleanQuestionText(item.question, idx)}"</p>
                    {item.requirement_focus && (
                      <p className="text-[10px] text-[#6b7063]">Requirement focus: {item.requirement_focus}</p>
                    )}
                  </div>

                  <div className="bg-[#f7f6f3] rounded-lg p-3.5 border border-[#e4e1da]/60">
                    <p className="text-xs font-semibold uppercase text-[#a8a49d] mb-1.5">Your Answer</p>
                    <p className="text-xs text-[#52574e] leading-relaxed whitespace-pre-wrap">
                      {item.candidate_answer || item.candidate_answer_excerpt || 'No answer submitted'}
                    </p>
                  </div>

                  <div className="bg-[#f0f7f4] rounded-lg p-3.5 border border-[#c8e6d8]">
                    <p className="text-xs font-semibold uppercase text-[#2d6a55] mb-1.5">AI Feedback</p>
                    <p className="text-xs text-[#245747] leading-relaxed">
                      {item.critique}
                    </p>
                  </div>

                  {(item.strengths || item.weaknesses || item.suggested_improvement) && (
                    <div className="grid sm:grid-cols-2 gap-4 mt-3 pt-3 border-t border-[#e4e1da]/50 text-xs">
                      {item.strengths && item.strengths.length > 0 && (
                        <div className="space-y-1">
                          <span className="font-semibold text-[#2d6a55] block">Strengths</span>
                          <ul className="list-disc pl-4 space-y-1 text-[#52574e]">
                            {item.strengths.map((str: string, sIdx: number) => (
                              <li key={sIdx}>{str}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {item.weaknesses && item.weaknesses.length > 0 && (
                        <div className="space-y-1">
                          <span className="font-semibold text-[#c25a2a] block">Areas for Growth</span>
                          <ul className="list-disc pl-4 space-y-1 text-[#52574e]">
                            {item.weaknesses.map((weak: string, wIdx: number) => (
                              <li key={wIdx}>{weak}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {item.suggested_improvement && (
                        <div className="sm:col-span-2 space-y-1 pt-1">
                          <span className="font-semibold text-[#1c1c1a] block">Suggested Improvement</span>
                          <p className="text-[#52574e] leading-relaxed">{item.suggested_improvement}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Static Backup Critique */
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold text-base">Performance Analysis</h3>
                <p className="text-xs text-[#6b7063]">Generated by the AI Interview Agent</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="border-l-2 border-[#2d6a55] bg-[#f0f9f4] rounded-r-xl p-4">
                <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-2 font-semibold">Key Strengths</p>
                <ul className="space-y-1.5">
                  <li className="text-xs text-[#3d5a4a] flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2d6a55] flex-shrink-0 mt-0.5" />
                    Clear articulation of technical concepts and trade-offs
                  </li>
                  <li className="text-xs text-[#3d5a4a] flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2d6a55] flex-shrink-0 mt-0.5" />
                    Practical understanding of real-world system constraints
                  </li>
                </ul>
              </div>

              <div className="border-l-2 border-[#c9a84c] bg-[#fdf8ee] rounded-r-xl p-4">
                <p className="text-xs tracking-wider uppercase text-[#c9a84c] mb-2 font-semibold">Growth Opportunities</p>
                <ul className="space-y-1.5">
                  <li className="text-xs text-[#5a4d2a] flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-[#c9a84c] flex-shrink-0 mt-0.5" />
                    Deeper exploration of distributed consensus mechanisms
                  </li>
                  <li className="text-xs text-[#5a4d2a] flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-[#c9a84c] flex-shrink-0 mt-0.5" />
                    More specific examples from production experience
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* HR Manager Feedback */}
        {hrFeedback && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold text-base">Hiring Manager Feedback</h3>
                <p className="text-xs text-[#6b7063]">Direct feedback from the recruiting team</p>
              </div>
            </div>
            <div className="bg-[#f8faf8] rounded-xl p-4 border border-[#e4e1da]/50 text-xs text-[#52574e] leading-relaxed">
              {hrFeedback}
            </div>
          </div>
        )}

        {/* 3-Week Roadmap */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-[#2d6a55]" />
            </div>
            <div>
              <h3 className="text-[#1c1c1a] font-semibold text-base">3-Week Upskilling Roadmap</h3>
              <p className="text-xs text-[#6b7063]">Curated by the Report Agent for your specific growth areas</p>
            </div>
          </div>

          <div className="space-y-3">
            {roadmap.map((week) => (
              <div
                key={week.week}
                className="border border-[#e4e1da] rounded-xl p-5 hover:border-[#2d6a55]/30 transition-colors shadow-sm bg-white"
              >
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 bg-[#f0ede8] rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-[#6b7063]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-[#a8a49d] font-semibold">Week {week.week}</span>
                      <span className="text-xs text-[#e4e1da]">—</span>
                      <span className="text-sm text-[#1c1c1a] font-medium">{week.title}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {week.tasks.map((task, taskIndex) => (
                        <li
                          key={taskIndex}
                          className="flex items-start gap-2 text-xs text-[#6b7063] leading-relaxed"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-[#e4e1da] flex-shrink-0 mt-1.5" />
                          <span>{task}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-[#1c1c1a] rounded-2xl p-8 text-center mb-5 shadow-md">
          <h2 className="text-white mb-3 text-xl font-semibold">What Happens Next</h2>
          <p className="text-sm text-[#9a9690] mb-6 max-w-md mx-auto leading-relaxed">
            {isHighScore
              ? 'Our hiring team will review your profile and responses. Expect to hear from us within 3–5 business days regarding next steps.'
              : "While your score didn't meet our current threshold, we encourage you to work through the upskilling roadmap and reapply. We believe in your potential."}
          </p>
          <Link
            to="/candidate/home"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to Candidate Dashboard
          </Link>
        </div>

        <p className="text-center text-xs text-[#a8a49d]">
          This feedback is saved to {candidateData.email}
        </p>

      </div>
    </div>
  );
}
