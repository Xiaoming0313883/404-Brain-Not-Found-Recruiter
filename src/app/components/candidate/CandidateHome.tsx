import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Progress from '@radix-ui/react-progress';
import { ArrowLeft, BarChart3, Briefcase, FileText, Loader2, LogOut, MessageSquare, PlayCircle, Users } from 'lucide-react';
import { CandidateData } from '../CandidatePortal';

interface Props {
  candidateData: CandidateData;
  onUpdateCandidate: (data: CandidateData) => void;
  onSignOut: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

const formatDateTime = (value?: string) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const statusLabels: Record<CandidateData['status'], string> = {
  profile: 'Profile Ready',
  sourced: 'Sourced & Invited',
  applied: 'Position Applied',
  screening: 'Interview In Progress',
  completed: 'Screening Completed'
};

const normalizeApplicationStatus = (status: string): CandidateData['status'] =>
  status === 'invited' || status === 'staged'
    ? 'sourced'
    : status === 'completed'
      ? 'completed'
      : status === 'screening'
        ? 'screening'
        : status === 'profile'
          ? 'profile'
          : 'applied';

export function CandidateHome({ candidateData, onUpdateCandidate, onSignOut }: Props) {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [isApplying, setIsApplying] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const applications = candidateData.applications || [];
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    candidateData.selectedApplicationId || applications[applications.length - 1]?.application_id || ''
  );
  const selectedApplication = applications.find(application => application.application_id === selectedApplicationId)
    || applications.find(application => application.position_id === candidateData.jobId)
    || applications[applications.length - 1];
  const selectedPositionId = selectedApplication?.position_id || candidateData.jobId;
  const selectedPosition = allPositions.find(position => position.id === selectedPositionId);
  const selectedStatus = normalizeApplicationStatus(selectedApplication?.status || candidateData.status);
  const progress = selectedApplication?.progress ?? (selectedStatus === 'completed' ? 100 : selectedStatus === 'screening' ? 70 : selectedStatus === 'profile' ? 10 : 40);
  const canReview = selectedStatus === 'completed';
  const canContinue = selectedStatus !== 'completed' && selectedStatus !== 'profile' && Boolean(selectedApplication);
  const appliedPositionIds = new Set(applications.map(application => application.position_id));

  useEffect(() => {
    fetch(`${API_BASE_URL}/jobs`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setAllPositions(data);
        setPositions(data.filter((position: any) => position.is_open_for_applications));
      })
      .catch(() => {
        setAllPositions([]);
        setPositions([]);
      });
  }, []);

  const mapCandidateFromApi = (data: any, positionTitle = ''): CandidateData => {
    const status = data.status === 'completed'
      ? 'completed'
      : data.status === 'screening'
        ? 'screening'
        : data.status === 'invited'
          ? 'sourced'
          : data.status === 'profile'
            ? 'profile'
            : 'applied';

    return {
      email: data.email,
      name: data.name,
      jobId: data.position_id,
      selectedApplicationId: data.application_id,
      applications: data.applications || [
        ...(candidateData.applications || []).filter(application => application.position_id !== data.position_id),
        {
          application_id: data.application_id || `position-${data.position_id}`,
          position_id: data.position_id,
          status,
          applied_at: data.applied_at,
          progress: status === 'completed' ? 100 : status === 'screening' ? 70 : 40,
          custom_questions: data.custom_questions,
          answers: data.answers,
          evaluation: data.evaluation,
          match_results: data.match_results
        }
      ],
      position: positionTitle || positions.find(position => position.id === data.position_id)?.title || candidateData.position,
      status,
      progress: status === 'profile' ? 10 : status === 'completed' ? 100 : status === 'screening' ? 66 : status === 'sourced' ? 50 : 33,
      isInvited: Boolean(data.is_sourced),
      appliedAt: data.applied_at,
      profilePictureUrl: data.profile_picture_url || candidateData.profilePictureUrl,
      resumeUrl: data.resume_url || candidateData.resumeUrl,
      resumeSummary: data.resume_summary || candidateData.resumeSummary,
      resumeData: data.resume_filename ? { filename: data.resume_filename } : candidateData.resumeData,
      recruitmentEmail: data.outreach_email,
      customQuestions: data.custom_questions,
      sandboxAnswers: data.answers,
      score: data.evaluation?.screening_score,
      evaluation: data.evaluation
    };
  };

  const handleApply = async (position: any) => {
    setIsApplying(position.id);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/apply-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: position.id })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to apply for position.');
      }
      const data = await response.json();
      const mapped = mapCandidateFromApi(data, position.title);
      onUpdateCandidate(mapped);
      setSelectedApplicationId(mapped.selectedApplicationId || `position-${position.id}`);
      navigate('/candidate/sandbox');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to apply for position.');
    } finally {
      setIsApplying(null);
    }
  };

  return (
    <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors">
            <ArrowLeft className="w-4 h-4" />
            All Portals
          </Link>
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm mb-5">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4 font-semibold">Candidate Account</p>
          <div className="flex items-start justify-between gap-5">
            <div>
              <h1 className="text-[#1c1c1a] text-2xl font-semibold mb-1">Welcome back, {candidateData.name}</h1>
              <p className="text-sm text-[#6b7063]">{candidateData.email}</p>
              <p className="text-sm text-[#1c1c1a] mt-3 font-medium">{selectedPosition?.title || candidateData.position || 'Candidate profile ready'}</p>
            </div>
            {candidateData.profilePictureUrl ? (
              <img src={`${API_ORIGIN}${candidateData.profilePictureUrl}`} alt={candidateData.name} className="w-14 h-14 rounded-2xl object-cover border border-[#e4e1da] flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-[#e8f2ee] flex items-center justify-center text-[#2d6a55] text-xl font-semibold flex-shrink-0">
                {candidateData.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-5 p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
            {errorMessage}
          </div>
        )}

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#6b7063] uppercase tracking-wider font-semibold">Application Progress</span>
            <span className="text-xs text-[#2d6a55] font-semibold">{statusLabels[selectedStatus]}</span>
          </div>
          <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-2 w-full">
            <Progress.Indicator
              className="bg-[#2d6a55] h-full transition-transform duration-500"
              style={{ transform: `translateX(-${100 - progress}%)`, width: '100%' }}
            />
          </Progress.Root>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <FileText className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Profile</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{candidateData.resumeData ? 'Resume Uploaded' : 'Profile On File'}</p>
            </div>
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <PlayCircle className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Interview</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{canContinue ? 'Ready' : 'Completed'}</p>
            </div>
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <BarChart3 className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Score</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{candidateData.score ?? '--'} / 100</p>
            </div>
          </div>
        </div>

        {applications.length > 0 && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <Users className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h2 className="text-[#1c1c1a] font-semibold">Application History</h2>
                <p className="text-xs text-[#6b7063]">Choose an applied position to continue, review feedback, or track progress.</p>
              </div>
              {candidateData.resumeUrl && (
                <a
                  href={`${API_ORIGIN}${candidateData.resumeUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex mt-4 text-xs text-[#2d6a55] font-semibold hover:underline"
                >
                  View uploaded resume PDF
                </a>
              )}
            </div>
            <div className="space-y-2">
              {applications.map(application => {
                const position = allPositions.find(item => item.id === application.position_id);
                const isSelected = application.application_id === selectedApplication?.application_id;
                const applicationStatus = normalizeApplicationStatus(application.status);
                return (
                  <button
                    key={application.application_id}
                    onClick={() => {
                      const status = normalizeApplicationStatus(application.status);
                      setSelectedApplicationId(application.application_id);
                      onUpdateCandidate({
                        ...candidateData,
                        selectedApplicationId: application.application_id,
                        jobId: application.position_id,
                        position: position?.title || candidateData.position,
                        status,
                        progress: application.progress ?? (status === 'completed' ? 100 : status === 'screening' ? 70 : 40),
                        appliedAt: application.applied_at,
                        customQuestions: application.custom_questions,
                        sandboxAnswers: application.answers,
                        score: application.evaluation?.screening_score,
                        evaluation: application.evaluation
                      });
                    }}
                    className={`w-full text-left border rounded-xl p-4 transition-colors ${isSelected ? 'border-[#2d6a55]/40 bg-[#f0f9f4]' : 'border-[#e4e1da] hover:bg-[#f7f6f3]'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#1c1c1a] font-semibold">{position?.title || `Position #${application.position_id}`}</p>
                        <p className="text-xs text-[#6b7063] mt-0.5">{position?.department || 'Hiring team'}</p>
                        <p className="text-xs text-[#a8a49d] mt-2">Applied: {formatDateTime(application.applied_at)}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e8f2ee] text-[#2d6a55] whitespace-nowrap">
                        {statusLabels[applicationStatus]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          {canContinue && (
            <Link
              to="/candidate/sandbox"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors text-sm font-medium shadow-sm"
            >
              <PlayCircle className="w-4 h-4" />
              Continue Interview
            </Link>
          )}
          <Link
            to={canReview ? '/candidate/feedback' : '/candidate/sandbox'}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
          >
            <BarChart3 className="w-4 h-4" />
            {canReview ? 'Review Results' : 'View Session'}
          </Link>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mt-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-[#2d6a55]" />
            </div>
            <div>
              <h2 className="text-[#1c1c1a] font-semibold">Available Positions</h2>
              <p className="text-xs text-[#6b7063]">Apply when you are ready to start a personalized interview session.</p>
            </div>
          </div>

          <div className="space-y-3">
            {positions.map(position => (
              <div key={position.id} className="border border-[#e4e1da] rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[#1c1c1a] font-semibold">{position.title}</p>
                    <p className="text-xs text-[#6b7063] mb-2">{position.department}</p>
                    <p className="text-xs text-[#6b7063] leading-relaxed">{position.description}</p>
                    <p className="text-xs text-[#a8a49d] mt-2">
                      Open: {formatDateTime(position.open_time)} to {formatDateTime(position.end_time)}
                      <span className="ml-2 text-[#2d6a55] font-semibold">{position.application_count || 0} applied</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {position.requirements?.map((requirement: string, index: number) => (
                        <span key={index} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">
                          {requirement}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleApply(position)}
                    disabled={isApplying !== null || appliedPositionIds.has(position.id)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    {isApplying === position.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    {appliedPositionIds.has(position.id) ? 'Applied' : 'Apply'}
                  </button>
                </div>
              </div>
            ))}
            {positions.length === 0 && (
              <p className="text-sm text-[#6b7063] py-6 text-center">No active positions are available right now.</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mt-5">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="w-4 h-4 text-[#2d6a55]" />
            <h2 className="text-[#1c1c1a] font-semibold">Agent & Hiring Manager Feedback</h2>
          </div>
          {candidateData.evaluation?.critiques?.length ? (
            <div className="space-y-3">
              {candidateData.evaluation.critiques.map((item: any, index: number) => (
                <div key={index} className="border-l-2 border-[#2d6a55] bg-[#f7f6f3] rounded-r-xl p-3">
                  <p className="text-xs text-[#2d6a55] font-semibold mb-1">Question {index + 1}</p>
                  <p className="text-xs text-[#6b7063]">{item.critique}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#6b7063]">Feedback will appear here after you complete an interview and the hiring manager reviews your progress.</p>
          )}
        </div>
      </div>
    </div>
  );
}
