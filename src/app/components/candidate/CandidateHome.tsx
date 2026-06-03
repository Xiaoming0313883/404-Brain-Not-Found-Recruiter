import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarChart3, Bell, BookOpen, Briefcase, Calendar, CheckCircle2, FileText, Loader2, MessageSquare, PlayCircle, Send, Target, User, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateData } from '../CandidatePortal';
import { CandidateNav } from './CandidateNav';
import { API_BASE_URL, API_ORIGIN } from '../../api';
import { KnowledgeTooltip } from '../KnowledgeTooltip';

interface Props {
  candidateData: CandidateData;
  onUpdateCandidate: (data: CandidateData) => void;
  onSignOut: () => void;
  view?: 'overview' | 'applications' | 'jobs' | 'profile';
}

const profileFieldConfig = [
  { field: 'name', label: 'full name', question: 'What is your full name as it should appear on your application?' },
  { field: 'age', label: 'age', question: 'What is your age?' },
  { field: 'phone', label: 'phone number', question: 'What phone number should the hiring team use if they need to reach you?' },
  { field: 'address', label: 'address', question: 'What is your current address?' },
  { field: 'cameFrom', label: 'came from', question: 'Where are you applying from, such as your city, country, university, referral source, or previous company?' },
  { field: 'workExperience', label: 'work experience', question: 'Please summarize your most relevant work experience.' },
  { field: 'qualification', label: 'qualification', question: 'What is your highest qualification, degree, diploma, certificate, or education level?' },
  { field: 'gradeResults', label: 'grade and results', question: 'What grade, CGPA, GPA, honors, or exam results should we keep on your profile?' }
] as const;

const formatDateTime = (value?: string) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const statusLabels: Record<CandidateData['status'], string> = {
  profile: 'Profile Ready',
  sourced: 'Sourced & Invited',
  staged: 'Sourced & Invited',
  invited: 'Sourced & Invited',
  applied: 'Position Applied',
  screening: 'Under Review',
  completed: 'Screening Completed',
  hired: 'Hired',
  rejected: 'Not Selected',
  interview_scheduled: 'Interview Scheduled'
};

const normalizeApplicationStatus = (status: string): CandidateData['status'] =>
  status === 'invited' || status === 'staged'
    ? 'invited'
    : status === 'completed'
      ? 'completed'
      : status === 'hired'
        ? 'hired'
        : status === 'screening'
          ? 'screening'
          : status === 'rejected'
            ? 'rejected'
            : status === 'interview_scheduled'
              ? 'interview_scheduled'
              : status === 'profile'
                ? 'profile'
                : status === 'applied'
                  ? 'applied'
                  : 'invited';
const getPhaseLabel = (status: string, hasAnswers: boolean): string => {
  if (status === 'hired') return 'Hired';
  if (status === 'rejected') return 'Rejected';
  if (status === 'interview_scheduled') return 'Interview In Progress';
  if (status === 'completed') return 'Waiting for Interview';
  if (status === 'screening' || hasAnswers) return 'Screening Completed';
  return 'Waiting for Screening';
};

const hasSubmittedInterviewAnswers = (answers?: string[]): boolean =>
  Array.isArray(answers) && answers.some(answer => answer.trim().length > 0);

const isPendingInterview = (status: string, answers?: string[]): boolean =>
  ['staged', 'invited', 'applied', 'screening'].includes(status) && !hasSubmittedInterviewAnswers(answers);

const getActiveStepIndex = (status: string, hasAnswers: boolean): number => {
  if (status === 'rejected') return 4;
  if (status === 'hired') return 4;
  if (status === 'interview_scheduled') return 3;
  if (status === 'completed') return 2;
  if (status === 'screening' || hasAnswers) return 1;
  return 0; // Waiting for Screening
};

const PAGE_SIZE = 10;
const getVisiblePages = (currentPage: number, totalPages: number) => {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return Array.from(pages)
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
};

const alignScoreMentions = (text: string, score: any) => {
  if (score === undefined || score === null || text === undefined || text === null) return text;
  return String(text)
    .replace(/(answer\s+scored\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(score\s+is\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(scored\s+)(\d+(?:\.\d+)?)(\s*out\s+of\s+100)/i, `$1${score}$3`);
};

export function CandidateHome({ candidateData, onUpdateCandidate, onSignOut, view = 'overview' }: Props) {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [isApplying, setIsApplying] = useState<number | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [profileChatInput, setProfileChatInput] = useState('');
  const profileChatScrollRef = useRef<HTMLDivElement | null>(null);
  const [applicationPage, setApplicationPage] = useState(1);
  const [positionPage, setPositionPage] = useState(1);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = (candidateData.notifications || []).filter(n => !n.read).length;

  const openPdfInBrowser = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank');
      if (!win) window.open(url, '_blank');
    } catch {
      window.open(url, '_blank');
    }
  };
  const [profileForm, setProfileForm] = useState({
    name: candidateData.name || '',
    age: candidateData.age || '',
    phone: candidateData.phone || '',
    address: candidateData.address || '',
    cameFrom: candidateData.cameFrom || '',
    location: candidateData.location || '',
    headline: candidateData.headline || '',
    workExperience: candidateData.workExperience || '',
    qualification: candidateData.qualification || '',
    gradeResults: candidateData.gradeResults || '',
    awards: (candidateData.awards || []).join(', '),
    skills: (candidateData.skills || []).join(', ')
  });
  const [profileChatMessages, setProfileChatMessages] = useState<Array<{ role: 'agent' | 'candidate'; content: string }>>(() => {
    const firstMissing = profileFieldConfig.find(item => !String(({
      name: candidateData.name || '',
      age: candidateData.age || '',
      phone: candidateData.phone || '',
      address: candidateData.address || '',
      cameFrom: candidateData.cameFrom || '',
      workExperience: candidateData.workExperience || '',
      qualification: candidateData.qualification || '',
      gradeResults: candidateData.gradeResults || ''
    } as Record<string, string>)[item.field] || '').trim());
    return [
      {
        role: 'agent',
        content: firstMissing
          ? `I summarized your resume into the profile below. I only need one missing detail: ${firstMissing.question}`
          : 'I summarized your resume into the profile below. Your required profile details are complete.'
      }
    ];
  });
  const previousProfileChatMessageCountRef = useRef(profileChatMessages.length);
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
  const progress = selectedApplication?.progress ?? (
    selectedStatus === 'completed' ? 100 :
    selectedStatus === 'hired' ? 100 :
    selectedStatus === 'rejected' ? 100 :
    selectedStatus === 'interview_scheduled' ? 85 :
    selectedStatus === 'screening' ? 70 :
    selectedStatus === 'profile' ? 10 : 40
  );
  const selectedEvaluation = selectedApplication?.evaluation || candidateData.evaluation;
  const selectedScore = selectedEvaluation?.screening_score ?? candidateData.score;
  const selectedScoreBreakdown = selectedEvaluation?.score_breakdown;
  const selectedAgentError = selectedApplication?.last_agent_error || candidateData.lastAgentError;
  const selectedHrFeedback = selectedApplication?.hr_feedback || candidateData.hrFeedback || '';
  const selectedRejectionMessage = selectedApplication?.rejection_message || candidateData.rejectionMessage || '';
  const selectedInterviewSlot = selectedApplication?.interview_slot || candidateData.interviewSlot;
  const selectedQuestionFeedback = selectedEvaluation?.question_feedback || selectedEvaluation?.critiques || [];
  const critiqueCounts = selectedQuestionFeedback.reduce((counts: Record<string, number>, item: any) => {
    const key = String(item?.critique || '').trim().toLowerCase();
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const getDisplayCritique = (item: any, index: number) => {
    const key = String(item?.critique || '').trim().toLowerCase();
    const answer = item.candidate_answer || selectedApplication?.answers?.[index] || candidateData.sandboxAnswers?.[index] || item.candidate_answer_excerpt || '';
    const alignedCritique = alignScoreMentions(item.critique, item.per_answer_score);
    if (critiqueCounts[key] > 1 && answer) {
      return `${alignedCritique} Candidate evidence reviewed for this question: "${String(answer)}"`;
    }
    return alignedCritique;
  };
  const canReview = selectedStatus === 'screening' || selectedStatus === 'completed' || selectedStatus === 'hired' || selectedStatus === 'interview_scheduled' || selectedStatus === 'rejected';
  const canContinue = selectedStatus !== 'completed' && selectedStatus !== 'hired' && selectedStatus !== 'rejected' && selectedStatus !== 'interview_scheduled' && selectedStatus !== 'profile' && Boolean(selectedApplication) && !selectedAgentError && !(selectedApplication?.answers?.length);
  const showReviewResultsAction = view === 'overview' && canReview;
  const showViewSessionAction = Boolean(selectedApplication) && !canReview;
  const showApplicationActions = Boolean(selectedAgentError || canContinue || showReviewResultsAction || showViewSessionAction || !selectedApplication);
  const appliedPositionIds = new Set(applications.map(application => application.position_id));
  const applicationTotalPages = Math.max(1, Math.ceil(applications.length / PAGE_SIZE));
  const applicationPageSafe = Math.min(applicationPage, applicationTotalPages);
  const paginatedApplications = applications.slice((applicationPageSafe - 1) * PAGE_SIZE, applicationPageSafe * PAGE_SIZE);
  const positionTotalPages = Math.max(1, Math.ceil(positions.length / PAGE_SIZE));
  const positionPageSafe = Math.min(positionPage, positionTotalPages);
  const paginatedPositions = positions.slice((positionPageSafe - 1) * PAGE_SIZE, positionPageSafe * PAGE_SIZE);

  const renderPagination = (
    currentPage: number,
    totalPages: number,
    totalItems: number,
    itemLabel: string,
    setPage: (page: number | ((previous: number) => number)) => void
  ) => {
    if (totalPages <= 1) return null;
    const visiblePages = getVisiblePages(currentPage, totalPages);
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#e4e1da] pt-4 mt-4">
        <span className="text-xs text-[#6b7063]">
          Showing {Math.min(totalItems, (currentPage - 1) * PAGE_SIZE + 1)} to {Math.min(totalItems, currentPage * PAGE_SIZE)} of {totalItems} {itemLabel}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            disabled={currentPage === 1}
            onClick={() => setPage(previous => Math.max(1, previous - 1))}
            className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          {visiblePages.map((page, index) => (
            <span key={page} className="inline-flex items-center gap-1.5">
              {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-[#a8a49d]">...</span>}
              <button
                onClick={() => setPage(page)}
                className={`min-w-8 px-2.5 py-1.5 border rounded-lg text-xs font-semibold transition-colors ${
                  page === currentPage
                    ? 'border-[#2d6a55] bg-[#e8f2ee] text-[#2d6a55]'
                    : 'border-[#e4e1da] bg-white text-[#6b7063] hover:bg-[#f7f6f3]'
                }`}
              >
                {page}
              </button>
            </span>
          ))}
          <button
            disabled={currentPage === totalPages}
            onClick={() => setPage(previous => Math.min(totalPages, previous + 1))}
            className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

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

  useEffect(() => {
    if (errorMessage) toast.error(errorMessage);
  }, [errorMessage]);

  useEffect(() => {
    if (candidateData.selectedApplicationId && candidateData.selectedApplicationId !== selectedApplicationId) {
      setSelectedApplicationId(candidateData.selectedApplicationId);
    }
  }, [candidateData.selectedApplicationId, selectedApplicationId]);

  useEffect(() => {
    if (profileChatMessages.length <= previousProfileChatMessageCountRef.current) {
      previousProfileChatMessageCountRef.current = profileChatMessages.length;
      return;
    }

    const chatScroll = profileChatScrollRef.current;
    if (chatScroll) {
      window.requestAnimationFrame(() => {
        chatScroll.scrollTop = chatScroll.scrollHeight;
      });
    }
    previousProfileChatMessageCountRef.current = profileChatMessages.length;
  }, [profileChatMessages.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const mapCandidateFromApi = (data: any, positionTitle = ''): CandidateData => {
    const status = data.status === 'completed'
      ? 'completed'
      : data.status === 'hired'
        ? 'hired'
        : data.status === 'screening'
          ? 'screening'
          : data.status === 'rejected'
            ? 'rejected'
            : data.status === 'interview_scheduled'
              ? 'interview_scheduled'
              : data.status === 'invited'
                ? 'sourced'
                : data.status === 'profile'
                  ? 'profile'
                  : 'applied';

    const normalizedApplications = (data.applications || []).map((application: any) => {
      const applicationStatus = normalizeApplicationStatus(application.status);
      return {
        ...application,
        status: applicationStatus,
        progress: application.progress ?? (
          applicationStatus === 'completed' ? 100 :
          applicationStatus === 'hired' ? 100 :
          applicationStatus === 'rejected' ? 100 :
          applicationStatus === 'interview_scheduled' ? 85 :
          applicationStatus === 'screening' ? 70 : 40
        )
      };
    });

    const activeApp = normalizedApplications.find((app: any) => app.application_id === data.application_id)
      || normalizedApplications.find((app: any) => app.position_id === data.position_id)
      || normalizedApplications[normalizedApplications.length - 1];

    return {
      email: data.email,
      name: data.name,
      jobId: data.position_id,
      selectedApplicationId: data.application_id,
      applications: normalizedApplications.length ? normalizedApplications : [
        ...(candidateData.applications || []).filter(application => application.position_id !== data.position_id),
        {
          application_id: data.application_id || `position-${data.position_id}`,
          position_id: data.position_id,
          status,
          applied_at: data.applied_at,
          progress: status === 'completed' ? 100 : status === 'hired' ? 100 : status === 'rejected' ? 100 : status === 'interview_scheduled' ? 85 : status === 'screening' ? 70 : 40,
          custom_questions: data.custom_questions,
          answers: data.answers,
          evaluation: data.evaluation,
          match_results: data.match_results,
          hr_feedback: data.hr_feedback,
          rejection_message: data.rejection_message,
          rejected_at: data.rejected_at,
          hired_at: data.hired_at,
          interview_slot: data.interview_slot
        }
      ],
      position: positionTitle || positions.find(position => position.id === data.position_id)?.title || candidateData.position,
      status,
      progress: status === 'profile' ? 10 :
        status === 'completed' ? 100 :
        status === 'hired' ? 100 :
        status === 'rejected' ? 100 :
        status === 'interview_scheduled' ? 85 :
        status === 'screening' ? 66 :
        status === 'sourced' ? 50 : 33,
      isInvited: Boolean(data.is_sourced),
      appliedAt: data.applied_at,
      profilePictureUrl: data.profile_picture_url || candidateData.profilePictureUrl,
      resumeUrl: data.resume_url || candidateData.resumeUrl,
      resumeSummary: data.resume_summary || candidateData.resumeSummary,
      profileExtractionWarning: data.profile_data?.extraction_warning || candidateData.profileExtractionWarning,
      profileMissingFields: data.profile_missing_fields || candidateData.profileMissingFields || [],
      profileCompletion: data.profile_completion ?? candidateData.profileCompletion,
      resumeData: data.resume_filename ? { filename: data.resume_filename } : candidateData.resumeData,
      profileVerified: data.profile_verified ?? candidateData.profileVerified,
      age: data.profile_data?.age || candidateData.age,
      address: data.profile_data?.address || candidateData.address,
      cameFrom: data.profile_data?.came_from || candidateData.cameFrom,
      location: data.profile_data?.location || candidateData.location,
      headline: data.profile_data?.headline || candidateData.headline,
      about: data.profile_data?.about || candidateData.about,
      workExperience: data.profile_data?.work_experience || candidateData.workExperience,
      qualification: data.profile_data?.qualification || candidateData.qualification,
      gradeResults: data.profile_data?.grade_results || candidateData.gradeResults,
      awards: data.profile_data?.awards || candidateData.awards,
      phone: data.profile_data?.phone || candidateData.phone,
      skills: data.profile_data?.skills || candidateData.skills,
      experiences: data.profile_data?.experiences || candidateData.experiences,
      education: data.profile_data?.education || candidateData.education,
      recruitmentEmail: data.outreach_email,
      customQuestions: data.custom_questions,
      sandboxAnswers: data.answers,
      score: data.evaluation?.screening_score,
      evaluation: data.evaluation,
      hrFeedback: activeApp?.hr_feedback || data.hr_feedback || '',
      rejectionMessage: activeApp?.rejection_message || data.rejection_message || '',
      rejectedAt: activeApp?.rejected_at || data.rejected_at,
      hiredAt: activeApp?.hired_at || data.hired_at,
      interviewSlot: activeApp?.interview_slot || data.interview_slot,
      agentWarnings: data.agent_warnings || activeApp?.agent_warnings || candidateData.agentWarnings || [],
      notifications: data.notifications || candidateData.notifications || [],
      sourceType: data.source_type || candidateData.sourceType,
      sourceMethod: data.source_method || candidateData.sourceMethod,
      lastAgentError: activeApp?.last_agent_error || data.last_agent_error || ''
    };
  };

  const handleApply = async (position: any) => {
    if (candidateData.emailVerified === false) {
      setErrorMessage('Verify your email address before applying to a position.');
      return;
    }
    if (!candidateData.profileVerified) {
      setErrorMessage('Verify your basic information before applying to a position.');
      return;
    }
    if (appliedPositionIds.has(position.id)) {
      setErrorMessage('You have already applied for this position.');
      return;
    }
    setIsApplying(position.id);
    setErrorMessage('');
    try {
      navigate('/candidate/apply-loading', { state: { position } });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to apply for position.');
    } finally {
      setIsApplying(null);
    }
  };

  const syncSelectedApplication = (application = selectedApplication, position?: any) => {
    if (!application) return;
    const status = normalizeApplicationStatus(application.status);
    const resolvedPosition = position || allPositions.find(item => item.id === application.position_id);
    setSelectedApplicationId(application.application_id);
    onUpdateCandidate({
      ...candidateData,
      selectedApplicationId: application.application_id,
      jobId: application.position_id,
      position: resolvedPosition?.title || candidateData.position || `Position #${application.position_id}`,
      status,
      progress: application.progress ?? (
        status === 'completed' ? 100 :
        status === 'hired' ? 100 :
        status === 'rejected' ? 100 :
        status === 'interview_scheduled' ? 85 :
        status === 'screening' ? 70 :
        status === 'profile' ? 10 : 40
      ),
      appliedAt: application.applied_at,
      customQuestions: application.custom_questions,
      sandboxAnswers: application.answers?.length ? application.answers : application.draft_answers,
      score: application.evaluation?.screening_score,
      evaluation: application.evaluation,
      hrFeedback: application.hr_feedback || '',
      rejectionMessage: application.rejection_message || '',
      rejectedAt: application.rejected_at,
      hiredAt: application.hired_at,
      interviewSlot: application.interview_slot,
      agentWarnings: application.agent_warnings || candidateData.agentWarnings || [],
      lastAgentError: application.last_agent_error || ''
    });
  };

  const getMissingFields = (form = profileForm) =>
    profileFieldConfig.filter(item => !String(form[item.field] || '').trim());

  const missingProfileFields = getMissingFields();
  const nextMissingField = missingProfileFields[0];
  const profileReady = missingProfileFields.length === 0;
  const profileCompletion = Math.max(0, Math.round(((profileFieldConfig.length - missingProfileFields.length) / profileFieldConfig.length) * 100));

  const buildProfilePayload = (form = profileForm) => ({
    name: form.name.trim(),
    age: form.age.trim(),
    phone: form.phone.trim(),
    address: form.address.trim(),
    came_from: form.cameFrom.trim(),
    location: form.location.trim(),
    headline: form.headline.trim(),
    work_experience: form.workExperience.trim(),
    qualification: form.qualification.trim(),
    grade_results: form.gradeResults.trim(),
    awards: form.awards.split(',').map(award => award.trim()).filter(Boolean),
    skills: form.skills.split(',').map(skill => skill.trim()).filter(Boolean)
  });

  const saveProfileDetails = async (form = profileForm) => {
    setIsSavingProfile(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProfilePayload(form))
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save profile details.');
      }
      const data = await response.json();
      const updatedAwards = data.profile_data?.awards || form.awards.split(',').map(award => award.trim()).filter(Boolean);
      const updatedSkills = data.profile_data?.skills || form.skills.split(',').map(skill => skill.trim()).filter(Boolean);
      onUpdateCandidate({
        ...candidateData,
        name: data.name,
        profileVerified: data.profile_verified,
        profileMissingFields: data.profile_missing_fields || [],
        profileCompletion: data.profile_completion ?? profileCompletion,
        profileExtractionWarning: data.profile_data?.extraction_warning || candidateData.profileExtractionWarning,
        age: data.profile_data?.age || form.age,
        address: data.profile_data?.address || form.address,
        cameFrom: data.profile_data?.came_from || form.cameFrom,
        location: data.profile_data?.location || form.location,
        headline: data.profile_data?.headline || form.headline,
        about: data.profile_data?.about || candidateData.about,
        workExperience: data.profile_data?.work_experience || form.workExperience,
        qualification: data.profile_data?.qualification || form.qualification,
        gradeResults: data.profile_data?.grade_results || form.gradeResults,
        awards: updatedAwards,
        phone: data.profile_data?.phone || form.phone,
        skills: updatedSkills,
        experiences: data.profile_data?.experiences || candidateData.experiences,
        education: data.profile_data?.education || candidateData.education,
        agentWarnings: data.agent_warnings || candidateData.agentWarnings || []
      });
      toast.success('Profile details saved.');
      return data;
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save profile details.');
      return null;
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleProfileChatSubmit = async () => {
    const answer = profileChatInput.trim();
    if (!answer || !nextMissingField || isSavingProfile) return;

    setProfileChatInput('');
    setProfileChatMessages(current => [
      ...current,
      { role: 'candidate', content: answer }
    ]);
    setIsSavingProfile(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/profile-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: nextMissingField.field, message: answer })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Missing Information Assistant failed.');
      const updated = data.candidate;
      const nextForm = {
        ...profileForm,
        name: updated.profile_data?.name || updated.name || profileForm.name,
        age: updated.profile_data?.age || profileForm.age,
        phone: updated.profile_data?.phone || profileForm.phone,
        address: updated.profile_data?.address || profileForm.address,
        cameFrom: updated.profile_data?.came_from || profileForm.cameFrom,
        location: updated.profile_data?.location || profileForm.location,
        headline: updated.profile_data?.headline || profileForm.headline,
        workExperience: updated.profile_data?.work_experience || profileForm.workExperience,
        qualification: updated.profile_data?.qualification || profileForm.qualification,
        gradeResults: updated.profile_data?.grade_results || profileForm.gradeResults,
        awards: (updated.profile_data?.awards || []).join(', '),
        skills: (updated.profile_data?.skills || []).join(', ')
      };
      setProfileForm(nextForm);
      onUpdateCandidate({
        ...candidateData,
        name: updated.name,
        profileVerified: updated.profile_verified,
        profileMissingFields: updated.profile_missing_fields || [],
        profileCompletion: updated.profile_completion,
        age: updated.profile_data?.age || '',
        address: updated.profile_data?.address || '',
        cameFrom: updated.profile_data?.came_from || '',
        phone: updated.profile_data?.phone || '',
        workExperience: updated.profile_data?.work_experience || '',
        qualification: updated.profile_data?.qualification || '',
        gradeResults: updated.profile_data?.grade_results || '',
        notifications: updated.notifications || candidateData.notifications || []
      });
      toast.success('Profile detail saved.');
      setProfileChatMessages(current => [...current, { role: 'agent', content: data.question || data.message }]);
    } catch (err: any) {
      setErrorMessage(err.message || 'Missing Information Assistant failed.');
      setProfileChatMessages(current => [...current, { role: 'agent', content: err.message || 'I could not validate that answer. Please try again.' }]);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const renderApplicationProgress = () => (
    <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-[#6b7063] uppercase tracking-wider font-semibold">Application Progress</span>
        <span className="text-xs text-[#2d6a55] font-bold bg-[#e8f2ee] px-2.5 py-0.5 rounded-full">
          {getPhaseLabel(selectedStatus, Boolean(selectedApplication?.answers?.length))}
        </span>
      </div>

      {(() => {
        const steps = [
          { label: 'Waiting for Screening', description: 'Complete warm-up sandbox' },
          { label: 'Screening Completed', description: 'AI evaluation submitted' },
          { label: 'Waiting for Interview', description: 'Screening passed, wait list' },
          { label: 'Interview In Progress', description: 'Interview scheduled or active' },
          {
            label: selectedStatus === 'rejected' ? 'Rejected' : 'Hired',
            description: selectedStatus === 'rejected' ? 'Application processed' : 'Offer extended!'
          }
        ];
        const activeStepIndex = getActiveStepIndex(selectedStatus, Boolean(selectedApplication?.answers?.length));

        return (
          <div className="w-full py-5">
            <div className="relative">
              <div className="absolute left-[10%] right-[10%] top-4 h-1 rounded-full bg-[#f0ede8]" />
              <div
                className="absolute left-[10%] top-4 h-1 rounded-full bg-[#2d6a55] transition-all duration-500"
                style={{ width: `calc(${(activeStepIndex / (steps.length - 1)) * 80}%)` }}
              />
              <div className="relative grid grid-cols-5 gap-1 sm:gap-2">
                {steps.map((step, idx) => {
                  const isActive = idx === activeStepIndex;
                  const isCompleted = idx < activeStepIndex;
                  const isTerminalRejected = idx === 4 && selectedStatus === 'rejected';
                  const isTerminalHired = idx === 4 && selectedStatus === 'hired';

                  let nodeStyles = 'bg-white border-2 border-[#e4e1da] text-[#a8a49d]';
                  if (isActive) {
                    if (isTerminalRejected) {
                      nodeStyles = 'bg-[#b91c1c] border-[#b91c1c] text-white ring-4 ring-[#b91c1c]/20 shadow-lg';
                    } else if (isTerminalHired) {
                      nodeStyles = 'bg-[#2d6a55] border-[#2d6a55] text-white ring-4 ring-[#2d6a55]/20 shadow-lg';
                    } else {
                      nodeStyles = 'bg-[#2d6a55] border-[#2d6a55] text-white ring-4 ring-[#2d6a55]/20 shadow-lg';
                    }
                  } else if (isCompleted) {
                    nodeStyles = 'bg-[#2d6a55] border-[#2d6a55] text-white';
                  }

                  let textStyles = 'text-[#6b7063]';
                  if (isActive) {
                    textStyles = isTerminalRejected ? 'text-[#b91c1c] font-bold' : 'text-[#2d6a55] font-bold';
                  }

                  return (
                    <div key={idx} className="min-w-0 flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-500 shadow-sm ${nodeStyles}`}>
                        {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                      </div>
                      <p className={`text-[10px] sm:text-[11px] font-semibold text-center mt-3 w-full max-w-[8.5rem] leading-tight transition-colors duration-300 break-words ${textStyles}`}>
                        {step.label}
                      </p>
                      <p className="hidden md:block text-[9px] text-[#a8a49d] text-center max-w-[100px] mt-0.5 leading-normal">
                        {step.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-3 gap-3 mt-5">
        <div className="border border-[#e4e1da] rounded-xl p-4">
          <FileText className="w-4 h-4 text-[#2d6a55] mb-2" />
          <p className="text-xs text-[#a8a49d]">Profile</p>
          <p className="text-sm text-[#1c1c1a] font-medium">{candidateData.resumeData ? 'Resume Uploaded' : 'Profile On File'}</p>
        </div>
        <div className="border border-[#e4e1da] rounded-xl p-4">
          <PlayCircle className="w-4 h-4 text-[#2d6a55] mb-2" />
          <p className="text-xs text-[#a8a49d]">Interview</p>
          <div className="text-sm text-[#1c1c1a] font-medium mt-1">
            {(() => {
              const pending = isPendingInterview(selectedApplication?.status || candidateData.status, selectedApplication?.answers);
              if (pending) {
                return (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#fff8ed] text-[#8a5a14] border border-[#f2d3a4] uppercase tracking-wide">
                    Pending Interview
                  </span>
                );
              }
              return !selectedApplication
                ? 'Waiting for Interview'
                : selectedStatus === 'interview_scheduled'
                  ? 'Interview Scheduled'
                  : (selectedStatus === 'completed' || selectedStatus === 'screening' || selectedStatus === 'hired' || selectedStatus === 'rejected')
                    ? 'Interview Completed'
                    : 'Waiting for Interview';
            })()}
          </div>
        </div>
        <div className="border border-[#e4e1da] rounded-xl p-4">
          <BarChart3 className="w-4 h-4 text-[#2d6a55] mb-2" />
          <p className="text-xs text-[#a8a49d]">Score</p>
          <p className="text-sm text-[#1c1c1a] font-medium">{selectedScore ?? '--'} / 100</p>
        </div>
      </div>
    </div>
  );

  const renderUpskillingRoadmap = () => {
    if (!['screening', 'completed', 'hired', 'interview_scheduled'].includes(selectedStatus)) return null;

    const rawRoadmap = selectedEvaluation?.upskilling_roadmap || {};
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

    return (
      <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 mb-5 shadow-sm text-left">
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
    );
  };

  const renderSelectedApplicationResults = () => {
    if (!selectedApplication) {
      return (
        <div className="mt-3 rounded-xl border border-dashed border-[#e4e1da] bg-[#f7f6f3] p-4 text-sm text-[#6b7063]">
          Choose an application to review its status and results.
        </div>
      );
    }

    const hasCritiques = Boolean(selectedQuestionFeedback.length);
    const hasResults = canReview || Boolean(selectedScore !== undefined || selectedHrFeedback || selectedRejectionMessage || selectedInterviewSlot || hasCritiques);

    return (
      <div className="mt-3 rounded-2xl border border-[#d7e8df] bg-white p-5 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider uppercase text-[#2d6a55] font-semibold">Application Result</p>
            <h3 className="text-[#1c1c1a] font-semibold mt-1">
              {selectedPosition?.title || `Position #${selectedPositionId}`}
            </h3>
            <p className="text-xs text-[#6b7063] mt-1">
              {selectedEvaluation?.role_alignment_summary || selectedEvaluation?.position_fit_verdict || 'Result details update as the hiring team reviews this application.'}
            </p>
            {selectedEvaluation?.decision_reason && (
              <p className="mt-2 rounded-lg bg-[#f7f6f3] px-3 py-2 text-xs leading-relaxed text-[#52574e]">
                <span className="font-semibold text-[#1c1c1a]">Decision reason:</span> {selectedEvaluation.decision_reason}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] px-4 py-3 text-center min-w-24">
            <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Score</p>
            <p className="text-2xl text-[#1c1c1a] font-semibold">{selectedScore ?? '--'}</p>
          </div>
        </div>

        {selectedStatus === 'rejected' && (
          <div className="rounded-xl border border-[#f5c2c2] bg-[#fff8f8] p-4">
            <p className="text-xs tracking-wider uppercase text-[#b91c1c] font-semibold mb-1">Not Selected</p>
            <p className="text-sm text-[#52574e] leading-relaxed">
              {selectedRejectionMessage || 'Thank you for applying. The hiring team has decided to move forward with other candidates for this position.'}
            </p>
          </div>
        )}

        {selectedStatus === 'hired' && (
          <div className="rounded-xl border border-[#c8e6d8] bg-[#f0f9f4] p-4">
            <div className="flex items-center gap-2 text-[#245747] font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>Congratulations, you have been hired for this position.</span>
            </div>
          </div>
        )}

        {selectedStatus === 'interview_scheduled' && selectedInterviewSlot && (
          <div className="rounded-xl border border-[#c5cbf7] bg-[#f5f7ff] p-4">
            <p className="text-xs tracking-wider uppercase text-[#3730a3] font-semibold mb-2">Interview Scheduled</p>
            <div className="grid sm:grid-cols-2 gap-3 text-sm text-[#1c1c1a]">
              <div>
                <span className="block text-xs text-[#a8a49d] font-medium">Date &amp; Time</span>
                <span className="font-semibold">{selectedInterviewSlot.date} at {selectedInterviewSlot.time}</span>
              </div>
              <div>
                <span className="block text-xs text-[#a8a49d] font-medium">Location / Link</span>
                <span className="font-semibold">{selectedInterviewSlot.location}</span>
              </div>
            </div>
            {selectedInterviewSlot.notes && (
              <p className="text-xs text-[#6b7063] leading-relaxed mt-3">{selectedInterviewSlot.notes}</p>
            )}
          </div>
        )}

        {selectedScoreBreakdown && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-[#2d6a55]" />
              <p className="text-sm text-[#1c1c1a] font-semibold">Position-Focused Score Breakdown</p>
              <KnowledgeTooltip label="What the score breakdown means">
                The Interview Agent scores role fit, depth, evidence, impact, and clarity from your answers to this position's custom questions.
              </KnowledgeTooltip>
            </div>
            <div className="grid sm:grid-cols-5 gap-2">
              {[
                ['Role', selectedScoreBreakdown.role_requirement_alignment, 35],
                ['Depth', selectedScoreBreakdown.technical_correctness_depth, 25],
                ['Evidence', selectedScoreBreakdown.evidence_specificity, 20],
                ['Impact', selectedScoreBreakdown.position_impact, 10],
                ['Clarity', selectedScoreBreakdown.communication_clarity, 10]
              ].map(([label, value, max]) => (
                <div key={String(label)} className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-3 text-center">
                  <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">{label}</p>
                  <p className="text-sm text-[#1c1c1a] font-semibold mt-1">{value || 0}/{max}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasCritiques ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-[#2d6a55]" />
              <p className="text-sm text-[#1c1c1a] font-semibold">Question-by-Question Feedback</p>
              <KnowledgeTooltip label="How feedback is produced">
                Feedback is generated per question by comparing your answer with the job requirements, then summarizing strengths, gaps, improvements, and HR follow-up notes.
              </KnowledgeTooltip>
            </div>
            <div className="space-y-3">
              {selectedQuestionFeedback.map((item: any, index: number) => (
                <div key={index} className="border-l-2 border-[#2d6a55] bg-[#f8faf8] rounded-r-xl p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[#2d6a55] uppercase tracking-wider font-semibold">Question {index + 1}</p>
                    {item.per_answer_score !== undefined && (
                      <p className="text-xs text-[#2d6a55] font-semibold">{item.per_answer_score}/100</p>
                    )}
                  </div>
                  {item.question && <p className="text-xs text-[#1c1c1a] font-medium leading-relaxed">{item.question}</p>}
                  {(item.candidate_answer || item.candidate_answer_excerpt || selectedApplication.answers?.[index]) && (
                    <p className="text-xs text-[#52574e] leading-relaxed">
                      <span className="font-semibold text-[#1c1c1a]">Your answer:</span> {item.candidate_answer || selectedApplication.answers?.[index] || item.candidate_answer_excerpt}
                    </p>
                  )}
                  {item.requirement_focus && (
                    <p className="text-xs text-[#6b7063]"><span className="font-semibold text-[#1c1c1a]">Role focus:</span> {item.requirement_focus}</p>
                  )}
                  <p className="text-xs text-[#52574e] leading-relaxed">{getDisplayCritique(item, index)}</p>
                  {item.decision_reason && (
                    <p className="rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-[#52574e]">
                      <span className="font-semibold text-[#1c1c1a]">Decision reason:</span> {item.decision_reason}
                    </p>
                  )}
                  {(item.strengths?.length || item.weaknesses?.length || item.suggested_improvement) && (
                    <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-[#e4e1da]/60">
                      {item.strengths?.length ? (
                        <div>
                          <p className="text-xs text-[#2d6a55] font-semibold mb-1">Strengths</p>
                          <ul className="list-disc pl-4 space-y-1 text-xs text-[#52574e]">
                            {item.strengths.map((strength: string, strengthIndex: number) => <li key={strengthIndex}>{strength}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {item.weaknesses?.length ? (
                        <div>
                          <p className="text-xs text-[#c25a2a] font-semibold mb-1">Areas for Growth</p>
                          <ul className="list-disc pl-4 space-y-1 text-xs text-[#52574e]">
                            {item.weaknesses.map((weakness: string, weaknessIndex: number) => <li key={weaknessIndex}>{weakness}</li>)}
                          </ul>
                        </div>
                      ) : null}
                      {item.suggested_improvement && (
                        <p className="sm:col-span-2 text-xs text-[#52574e] leading-relaxed">
                          <span className="font-semibold text-[#1c1c1a]">Suggested improvement:</span> {item.suggested_improvement}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-4 text-sm text-[#6b7063]">
            {hasResults ? 'Detailed question feedback has not been generated for this application yet.' : 'Results will appear here after you complete the warm-up interview and the hiring team reviews your progress.'}
          </div>
        )}

        {selectedHrFeedback && (
          <div className="rounded-xl border border-[#e4e1da] bg-[#f8faf8] p-4">
            <p className="text-xs tracking-wider uppercase text-[#2d6a55] font-semibold mb-2">Hiring Manager Feedback</p>
            <p className="text-xs text-[#52574e] leading-relaxed">{selectedHrFeedback}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen py-10 px-6 bg-[#f7f6f3]">
      <div className={`${view === 'overview' ? 'max-w-4xl' : 'max-w-5xl'} mx-auto`}>
        <CandidateNav onSignOut={onSignOut} />
        <div className="flex justify-end mb-4">
          <div className="flex items-center gap-3">
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifications(prev => !prev)}
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl border border-[#e4e1da] bg-white hover:bg-[#f7f6f3] transition-colors"
                title="Notifications"
              >
                <Bell className="w-4 h-4 text-[#6b7063]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#2d6a55] text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-11 z-50 w-80 bg-white border border-[#e4e1da] rounded-2xl shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#e4e1da] bg-[#f7f6f3]">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[#2d6a55]" />
                      <span className="text-sm font-semibold text-[#1c1c1a]">Notifications</span>
                      {unreadCount > 0 && (
                        <span className="px-2 py-0.5 bg-[#2d6a55] text-white text-[10px] font-bold rounded-full">
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    <button onClick={() => setShowNotifications(false)} className="text-[#a8a49d] hover:text-[#1c1c1a] transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {(candidateData.notifications || []).length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <Bell className="w-8 h-8 text-[#e4e1da] mx-auto mb-2" />
                        <p className="text-sm text-[#a8a49d]">No notifications yet</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-[#f0ede8]">
                        {(candidateData.notifications || []).map(notification => (
                          <div
                            key={notification.id}
                            className={`px-4 py-3 ${notification.read ? 'bg-white' : 'bg-[#f0f9f4]'}`}
                          >
                            <div className="flex items-start gap-2">
                              {!notification.read && (
                                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#2d6a55] flex-shrink-0" />
                              )}
                              <div className={!notification.read ? '' : 'ml-4'}>
                                <p className="text-xs font-semibold text-[#1c1c1a]">{notification.title}</p>
                                <p className="text-xs text-[#6b7063] mt-0.5 leading-relaxed">{notification.message}</p>
                                <p className="text-[10px] text-[#a8a49d] mt-1">
                                  {new Date(notification.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm mb-5">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4 font-semibold">Candidate Account</p>
          <div className="flex items-start justify-between gap-5">
            <div>
              <h1 className="text-[#1c1c1a] text-2xl font-semibold mb-1">Welcome back, {candidateData.name}</h1>
              <p className="text-sm text-[#6b7063]">{candidateData.email}</p>
              <Link to="/candidate/profile" className="inline-flex items-center gap-2 mt-3 text-sm text-[#2d6a55] font-semibold hover:underline">
                <User className="w-4 h-4" />
                Edit profile
              </Link>
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



        {selectedStatus === 'rejected' && (
          <div className="mb-6 rounded-2xl border border-[#f5c2c2] bg-[#fff8f8] p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-[#fdf2f2] rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-[#b91c1c] text-lg font-bold">X</span>
              </div>
              <div className="flex-1">
                <p className="text-xs tracking-wider uppercase text-[#b91c1c] mb-1 font-semibold">Application Update</p>
                <h2 className="text-[#1c1c1a] mb-2 font-semibold text-lg">Thank you for your application</h2>
                <p className="text-sm text-[#52574e] leading-relaxed mb-2">
                  {selectedRejectionMessage || "Thank you for applying. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs. We appreciate the time you invested and wish you success in your career journey."}
                </p>
                {selectedHrFeedback && (
                  <div className="border-t border-[#f5c2c2] pt-4 mt-3">
                    <p className="text-xs font-semibold text-[#6b7063] uppercase tracking-wider mb-2">Hiring Team Notes & Feedback</p>
                    <div className="bg-[#fcf8f8] rounded-xl p-4 border border-[#f5c2c2]/30 text-sm text-[#6b7063] leading-relaxed">
                      {selectedHrFeedback}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {selectedStatus === 'hired' && (
          <div className="mb-6 rounded-2xl border border-[#c8e6d8] bg-[#f0f9f4] p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-[#245747]" />
              </div>
              <div className="flex-1">
                <p className="text-xs tracking-wider uppercase text-[#245747] mb-1 font-semibold">Application Complete</p>
                <h2 className="text-[#1c1c1a] mb-2 font-semibold text-lg">Congratulations, you have been hired</h2>
                <p className="text-sm text-[#52574e] leading-relaxed">
                  The hiring team has finalized recruitment for this position. Please watch your email for onboarding details and next steps.
                </p>
              </div>
            </div>
          </div>
        )}

        {candidateData.emailVerified === false && (
          <div className="mb-5 rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a14]">
            Email verification is required before applying to a position. Sign out and complete the verification step from the Candidate Portal.
          </div>
        )}

        {view === 'overview' && (
          <div className="grid md:grid-cols-3 gap-4 mb-5">
            <Link to="/candidate/profile" className="bg-white border border-[#e4e1da] rounded-2xl p-5 shadow-sm hover:border-[#2d6a55]/30 transition-colors">
              <FileText className="w-5 h-5 text-[#2d6a55] mb-3" />
              <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Profile</p>
              <p className="text-lg text-[#1c1c1a] font-semibold mt-1">{profileCompletion}% complete</p>
              <p className="text-xs text-[#6b7063] mt-1">{profileReady ? 'Ready to apply' : `${missingProfileFields.length} detail${missingProfileFields.length === 1 ? '' : 's'} missing`}</p>
            </Link>
            <Link to="/candidate/applications" className="bg-white border border-[#e4e1da] rounded-2xl p-5 shadow-sm hover:border-[#2d6a55]/30 transition-colors">
              <BarChart3 className="w-5 h-5 text-[#2d6a55] mb-3" />
              <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Current Status</p>
              <p className="text-lg text-[#1c1c1a] font-semibold mt-1">{getPhaseLabel(selectedStatus, Boolean(selectedApplication?.answers?.length))}</p>
              <p className="text-xs text-[#6b7063] mt-1">{applications.length} application{applications.length === 1 ? '' : 's'} on record</p>
            </Link>
            <Link to="/candidate/jobs" className="bg-white border border-[#e4e1da] rounded-2xl p-5 shadow-sm hover:border-[#2d6a55]/30 transition-colors">
              <Briefcase className="w-5 h-5 text-[#2d6a55] mb-3" />
              <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Open Jobs</p>
              <p className="text-lg text-[#1c1c1a] font-semibold mt-1">{positions.length} available</p>
              <p className="text-xs text-[#6b7063] mt-1">Browse roles on the Jobs page</p>
            </Link>
          </div>
        )}

        {view === 'profile' && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-4 h-4 text-[#2d6a55]" />
            <div>
              <h2 className="text-[#1c1c1a] font-semibold">Information Details</h2>
              <p className="text-xs text-[#6b7063]">Resume Agent summarized these details from your uploaded resume.</p>
            </div>
          </div>
          {candidateData.profileExtractionWarning && (
            <div className="mb-4 rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a14]">
              {candidateData.profileExtractionWarning}
            </div>
          )}
          {candidateData.agentWarnings?.length ? (
            <div className="mb-4 rounded-xl border border-[#f5c2c2] bg-[#fdf2f2] px-4 py-3 text-sm text-[#b91c1c] space-y-1">
              {candidateData.agentWarnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e4e1da] bg-[#f7f6f3] px-4 py-3 mb-4">
            <div>
              <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Profile Completion</p>
              <p className={`text-sm font-semibold ${profileReady ? 'text-[#2d6a55]' : 'text-[#c25a2a]'}`}>
                {profileReady ? 'Ready to apply' : `${missingProfileFields.length} missing ${missingProfileFields.length === 1 ? 'detail' : 'details'}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl text-[#1c1c1a] font-semibold">{profileCompletion}%</p>
              <p className="text-xs text-[#6b7063]">{candidateData.profileVerified ? 'Verified' : 'Not verified yet'}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[#e4e1da] p-4">
              <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Resume Summary</p>
              <p className="text-sm text-[#6b7063] leading-relaxed">
                {candidateData.about || candidateData.resumeSummary || 'The Resume Agent did not find a readable summary. Review your uploaded resume PDF if needed.'}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ['Full Name', profileForm.name],
                ['Email', candidateData.email],
                ['Phone', profileForm.phone],
                ['Age', profileForm.age],
                ['Location', profileForm.location],
                ['Came From', profileForm.cameFrom],
                ['Address', profileForm.address],
                ['Headline', profileForm.headline]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#e4e1da] p-4">
                  <p className="text-xs text-[#a8a49d] mb-1 font-medium">{label}</p>
                  <p className={`text-sm font-medium leading-relaxed ${value ? 'text-[#1c1c1a]' : 'text-[#c25a2a]'}`}>
                    {value || 'Missing'}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-[#e4e1da] p-4">
              <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Work Experience</p>
              <p className={`text-sm leading-relaxed ${profileForm.workExperience ? 'text-[#6b7063]' : 'text-[#c25a2a]'}`}>
                {profileForm.workExperience || 'Missing'}
              </p>
              {candidateData.experiences?.length ? (
                <div className="mt-3 space-y-2">
                  {candidateData.experiences.map((experience, index) => (
                    <div key={`${experience.title}-${index}`} className="rounded-lg bg-[#f7f6f3] border border-[#e4e1da] p-3">
                      <p className="text-sm text-[#1c1c1a] font-semibold">{experience.title || 'Experience'}</p>
                      <p className="text-xs text-[#6b7063] mt-0.5">{[experience.company, experience.duration].filter(Boolean).join(' - ') || 'Company details not found'}</p>
                      {experience.description && <p className="text-xs text-[#6b7063] mt-2 leading-relaxed">{experience.description}</p>}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#e4e1da] p-4">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Qualification</p>
                <p className={`text-sm leading-relaxed ${profileForm.qualification ? 'text-[#6b7063]' : 'text-[#c25a2a]'}`}>
                  {profileForm.qualification || 'Missing'}
                </p>
                {candidateData.education?.length ? (
                  <div className="mt-3 space-y-2">
                    {candidateData.education.map((education, index) => {
                      const qsRankEntry = candidateData.qsRanking?.find(
                        (r: any) => r.school && education.school && (
                          r.school.toLowerCase() === education.school.toLowerCase() ||
                          education.school.toLowerCase().includes(r.school.toLowerCase()) ||
                          r.school.toLowerCase().includes(education.school.toLowerCase())
                        )
                      );
                      const qsRank = qsRankEntry?.rank;
                      return (
                        <div key={`${education.degree}-${index}`} className="rounded-lg bg-[#f7f6f3] border border-[#e4e1da] p-3">
                          <p className="text-xs text-[#1c1c1a] font-semibold flex items-center justify-between flex-wrap gap-1">
                            <span>{education.degree || 'Education'}</span>
                            {qsRank ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#e8f2ee] text-[#2d6a55] border border-[#c8e6d8]">
                                QS Rank: #{qsRank}
                              </span>
                            ) : (
                              <span className="text-[#a8a49d] text-[9px] font-normal">
                                (Ranking Not Available)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[#6b7063] mt-0.5">{[education.school, education.duration].filter(Boolean).join(' - ')}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-[#e4e1da] p-4">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Grade and Results</p>
                <p className={`text-sm leading-relaxed ${profileForm.gradeResults ? 'text-[#6b7063]' : 'text-[#c25a2a]'}`}>
                  {profileForm.gradeResults || 'Missing'}
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#e4e1da] p-4">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {(profileForm.skills ? profileForm.skills.split(',').map(skill => skill.trim()).filter(Boolean) : []).length ? (
                    profileForm.skills.split(',').map(skill => skill.trim()).filter(Boolean).map(skill => (
                      <span key={skill} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">{skill}</span>
                    ))
                  ) : (
                    <p className="text-sm text-[#6b7063]">No skills detected.</p>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-[#e4e1da] p-4">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Awards</p>
                <div className="flex flex-wrap gap-1.5">
                  {(profileForm.awards ? profileForm.awards.split(',').map(award => award.trim()).filter(Boolean) : []).length ? (
                    profileForm.awards.split(',').map(award => award.trim()).filter(Boolean).map(award => (
                      <span key={award} className="px-2 py-0.5 bg-[#fdf8ee] rounded-full text-xs text-[#8a5a14]">{award}</span>
                    ))
                  ) : (
                    <p className="text-sm text-[#6b7063]">No awards detected.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!profileReady && (
            <div className="mt-5 rounded-xl border border-[#c8e6d8] bg-[#f8fcfa] p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-[#2d6a55]" />
                <p className="text-sm text-[#1c1c1a] font-semibold">Missing Information Assistant</p>
              </div>
              <div ref={profileChatScrollRef} className="bg-white border border-[#e4e1da] rounded-xl p-3 max-h-56 overflow-auto space-y-2 mb-3">
                {profileChatMessages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      message.role === 'candidate' ? 'bg-[#2d6a55] text-white' : 'bg-[#f0ede8] text-[#1c1c1a]'
                    }`}>
                      {message.content}
                    </div>
                  </div>
                ))}
                {isSavingProfile && (
                  <div className="flex justify-start">
                    <div className="rounded-xl px-3 py-2 text-xs bg-[#f0ede8] text-[#6b7063] inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving answer...
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={profileChatInput}
                  onChange={(event) => setProfileChatInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleProfileChatSubmit()}
                  placeholder={nextMissingField?.label ? `Answer ${nextMissingField.label}...` : 'All required details are complete'}
                  className="flex-1 px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
                />
                <button
                  onClick={handleProfileChatSubmit}
                  disabled={!profileChatInput.trim() || isSavingProfile}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed text-sm font-medium"
                >
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </div>
          )}

          {profileReady && (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-[#c8e6d8] bg-[#e8f2ee] px-4 py-3 text-sm text-[#2d6a55] font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Your required information details are complete.
            </div>
          )}
        </div>
        )}

        {errorMessage && (
          <div className="mb-5 p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
            {errorMessage}
          </div>
        )}

        {view === 'overview' && renderApplicationProgress()}
        {view === 'overview' && renderUpskillingRoadmap()}

        {view === 'applications' && (
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
                <button
                  onClick={() => openPdfInBrowser(`${API_ORIGIN}${candidateData.resumeUrl!}`)}
                  className="inline-flex mt-4 text-xs text-[#2d6a55] font-semibold hover:underline cursor-pointer"
                >
                  View uploaded resume PDF
                </button>
              )}
            </div>
            <div className="space-y-2">
              {applications.length === 0 && (
                <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-5 text-sm text-[#6b7063]">
                  You have not registered for any positions yet. Visit Jobs to apply when your profile is ready.
                </div>
              )}
              {paginatedApplications.map(application => {
                const position = allPositions.find(item => item.id === application.position_id);
                const isSelected = application.application_id === selectedApplication?.application_id;
                const applicationStatus = normalizeApplicationStatus(application.status);
                return (
                  <div key={application.application_id}>
                  <button
                    onClick={() => syncSelectedApplication(application, position)}
                    className={`w-full text-left border rounded-xl p-4 transition-colors ${isSelected ? 'border-[#2d6a55]/40 bg-[#f0f9f4]' : 'border-[#e4e1da] hover:bg-[#f7f6f3]'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#1c1c1a] font-semibold">{position?.title || `Position #${application.position_id}`}</p>
                        <p className="text-xs text-[#6b7063] mt-0.5">{position?.department || 'Hiring team'}</p>
                        <p className="text-xs text-[#a8a49d] mt-2">Applied: {formatDateTime(application.applied_at)}</p>
                      </div>
                      {isPendingInterview(application.status, application.answers) ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fff8ed] text-[#8a5a14] border border-[#f2d3a4] whitespace-nowrap">
                          Pending Interview
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e8f2ee] text-[#2d6a55] whitespace-nowrap">
                          {getPhaseLabel(applicationStatus, Boolean(application.answers?.length))}
                        </span>
                      )}
                    </div>
                  </button>
                  </div>
                );
              })}
            </div>
            {renderPagination(applicationPageSafe, applicationTotalPages, applications.length, 'applications', setApplicationPage)}
          </div>
        )}

        {view === 'applications' && (
          <>
            {renderApplicationProgress()}
            {renderUpskillingRoadmap()}
            {renderSelectedApplicationResults()}
          </>
        )}

        {(view === 'overview' || view === 'applications') && showApplicationActions && (
        <div className="grid sm:grid-cols-3 gap-3">
          {selectedAgentError && (
            <div className="sm:col-span-3 rounded-xl border border-[#f5c2c2] bg-[#fdf2f2] p-4 text-sm text-[#b91c1c]">
              {selectedAgentError}
            </div>
          )}
          {canContinue && (
            <Link
              to="/candidate/sandbox"
              onClick={() => syncSelectedApplication()}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors text-sm font-medium shadow-sm"
            >
              <PlayCircle className="w-4 h-4" />
              Continue Interview
            </Link>
          )}
          {showReviewResultsAction ? (
            <Link
              to="/candidate/applications"
              onClick={() => syncSelectedApplication()}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
            >
              <BarChart3 className="w-4 h-4" />
              Review Results
            </Link>
          ) : showViewSessionAction ? (
            <Link
              to="/candidate/sandbox"
              onClick={() => syncSelectedApplication()}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
            >
              <BarChart3 className="w-4 h-4" />
              View Session
            </Link>
          ) : (
            <div className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#a8a49d] rounded-xl text-sm font-medium shadow-sm">
              <BarChart3 className="w-4 h-4" />
                    <a href="/candidate/jobs" className="transition hover:text-[#4f46e5]">
                      Apply to a position
                    </a>
            </div>
          )}
        </div>
        )}

        {view === 'jobs' && (
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

          {(!candidateData.profileVerified || !candidateData.resumeUrl) && (
            <div className="mb-5 rounded-xl border border-[#c25a2a]/20 bg-[#fffaf5] p-4 text-sm text-[#c25a2a] space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <span>!</span>
                <span>Application Prerequisites Incomplete</span>
              </div>
              <p className="text-xs text-[#6b7063] leading-relaxed">
                Before you can apply for any position, you must complete the following:
              </p>
              <ul className="list-disc list-inside text-xs text-[#6b7063] pl-2 space-y-1">
                {!candidateData.profileVerified && (
                  <li>
                    <strong>Incomplete profile information:</strong> Please go to the <Link to="/candidate/profile" className="underline font-medium text-[#c25a2a] hover:text-[#a0441b]">Profile Information page</Link> and complete all mandatory fields.
                  </li>
                )}
                {!candidateData.resumeUrl && (
                  <li>
                    <strong>Missing resume upload:</strong> Please upload a PDF copy of your resume on the <Link to="/candidate/profile" className="underline font-medium text-[#c25a2a] hover:text-[#a0441b]">Profile Information page</Link>.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {paginatedPositions.map(position => (
              <div key={position.id} className="border border-[#e4e1da] rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[#1c1c1a] font-semibold">{position.title}</p>
                    <p className="text-xs text-[#6b7063] mb-2">{position.department}</p>
                    <p className="text-xs text-[#6b7063] leading-relaxed">{position.description}</p>
                    {position.address && (
                      <div className="mt-3 overflow-hidden rounded-xl border border-[#e4e1da]">
                        <iframe
                          title={`${position.title} map`}
                          src={`https://www.google.com/maps?q=${encodeURIComponent(position.address)}&output=embed`}
                          className="w-full h-40"
                          loading="lazy"
                        />
                      </div>
                    )}
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
                    disabled={isApplying !== null || appliedPositionIds.has(position.id) || !candidateData.profileVerified || !candidateData.resumeUrl}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    {isApplying === position.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    {!candidateData.profileVerified ? 'Verify Profile' : !candidateData.resumeUrl ? 'Upload Resume' : appliedPositionIds.has(position.id) ? 'Applied' : 'Apply'}
                  </button>
                </div>
              </div>
            ))}
            {positions.length === 0 && (
              <p className="text-sm text-[#6b7063] py-6 text-center">No active positions are available right now.</p>
            )}
          </div>
          {renderPagination(positionPageSafe, positionTotalPages, positions.length, 'positions', setPositionPage)}
        </div>
        )}

      </div>
    </div>
  );
}
