import { CandidateData } from '../CandidatePortal';
import { Link } from 'react-router';
import * as Progress from '@radix-ui/react-progress';
import { BookOpen, Calendar, ArrowLeft, CheckCircle2, TrendingUp, Target } from 'lucide-react';

interface Props {
  candidateData: CandidateData;
}

export function CandidateFeedback({ candidateData }: Props) {
  const score = candidateData.score || 0;
  const isHighScore = score >= 70;

  // Retrieve dynamically generated AI upskilling roadmap from evaluation details
  const rawRoadmap = candidateData.evaluation?.upskilling_roadmap || {};
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

  const critiques = candidateData.evaluation?.critiques || [];

  return (
    <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
      <div className="max-w-3xl mx-auto">

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
            {isHighScore
              ? 'Your responses demonstrate strong technical depth and excellent problem-solving ability. The hiring team will be reviewing your profile shortly.'
              : "Your responses show solid foundational thinking. We've prepared a personalized development roadmap to support your growth."}
          </p>
        </div>

        {/* Qualitative Critique from AI Agent */}
        {critiques && critiques.length > 0 ? (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold text-base">Question-by-Question AI Critique</h3>
                <p className="text-xs text-[#6b7063]">Detailed analysis by our Candidate Interview Agent</p>
              </div>
            </div>

            <div className="space-y-4">
              {critiques.map((item: any, idx: number) => (
                <div key={idx} className="border-l-2 border-[#2d6a55] bg-[#f8faf8] rounded-r-xl p-4">
                  <p className="text-xs font-semibold tracking-wide uppercase text-[#2d6a55] mb-1.5">Question {idx + 1}</p>
                  <p className="text-xs text-[#1c1c1a] italic mb-2 leading-relaxed font-medium">"{item.question}"</p>
                  <p className="text-xs text-[#52574e] leading-relaxed">{item.critique}</p>
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
          A copy of this feedback has been sent to {candidateData.email}
        </p>

      </div>
    </div>
  );
}
