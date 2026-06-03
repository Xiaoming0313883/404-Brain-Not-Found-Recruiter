import { useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { CandidateLogin } from './candidate/CandidateLogin';
import { CandidateHome } from './candidate/CandidateHome';
import { CandidateSandbox } from './candidate/CandidateSandbox';
import { CandidateInformation } from './candidate/CandidateInformation';
import { CandidateApplyLoading } from './candidate/CandidateApplyLoading';
import { CandidateFeedback } from './candidate/CandidateFeedback';
import { API_BASE_URL } from '../api';

export interface CandidateData {
  email: string;
  name: string;
  position: string;
  jobId?: number;
  selectedApplicationId?: string;
  applications?: Array<{
    application_id: string;
    position_id: number;
    status: 'profile' | 'sourced' | 'staged' | 'invited' | 'applied' | 'screening' | 'completed' | 'hired' | 'rejected' | 'interview_scheduled';
    applied_at?: string;
    progress?: number;
    custom_questions?: string[];
    answers?: string[];
    evaluation?: any;
    match_results?: any;
    hr_feedback?: string;
    rejection_message?: string;
    rejected_at?: string;
    hired_at?: string;
    interview_slot?: any;
    agent_warnings?: string[];
    draft_answers?: string[];
    last_agent_error?: string;
  }>;
  status: 'profile' | 'sourced' | 'applied' | 'screening' | 'completed' | 'hired' | 'rejected' | 'interview_scheduled';
  progress: number;
  isInvited: boolean;
  appliedAt?: string;
  profilePictureUrl?: string;
  resumeUrl?: string;
  resumeSummary?: string;
  profileExtractionWarning?: string;
  profileMissingFields?: Array<{ field: string; label: string }>;
  profileCompletion?: number;
  emailVerified?: boolean;
  resumeData?: any;
  profileVerified?: boolean;
  age?: string;
  address?: string;
  cameFrom?: string;
  location?: string;
  headline?: string;
  about?: string;
  workExperience?: string;
  qualification?: string;
  gradeResults?: string;
  awards?: string[];
  phone?: string;
  skills?: string[];
  experiences?: Array<{
    title?: string;
    company?: string;
    duration?: string;
    description?: string;
  }>;
  education?: Array<{
    school?: string;
    degree?: string;
    duration?: string;
  }>;
  sandboxAnswers?: string[];
  score?: number;
  recruitmentEmail?: string;
  customQuestions?: string[];
  evaluation?: any;
  hrFeedback?: string;
  rejectionMessage?: string;
  rejectedAt?: string;
  hiredAt?: string;
  interviewSlot?: any;
  agentWarnings?: string[];
  notifications?: Array<{ id: string; title: string; message: string; kind: string; position_id?: number; created_at: string; read: boolean }>;
  sourceType?: string;
  sourceMethod?: string;
  draftAnswers?: Record<string, string[]>;
  lastAgentError?: string;
  qsRanking?: Array<{ school: string; rank: number | null }>;
}

const CANDIDATE_SESSION_KEY = 'candidateSessionV3';

const loadCandidateSession = (): CandidateData | null => {
  window.localStorage.removeItem('candidateSession');
  window.localStorage.removeItem('candidateSessionV2');
  const stored = window.localStorage.getItem(CANDIDATE_SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as CandidateData;
  } catch {
    window.localStorage.removeItem(CANDIDATE_SESSION_KEY);
    return null;
  }
};

const persistCandidateSession = (candidate: CandidateData | null) => {
  if (candidate) {
    window.localStorage.setItem(CANDIDATE_SESSION_KEY, JSON.stringify(candidate));
  } else {
    window.localStorage.removeItem(CANDIDATE_SESSION_KEY);
  }
};

function CandidatePageAppear({ children, pageKey }: { children: ReactNode; pageKey: string }) {
  return (
    <motion.div
      key={pageKey}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export function CandidatePortal() {
  const location = useLocation();
  const [candidateData, setCandidateData] = useState<CandidateData | null>(loadCandidateSession);

  const updateCandidateData = (value: CandidateData | null | ((current: CandidateData | null) => CandidateData | null)) => {
    setCandidateData(current => {
      const next = typeof value === 'function'
        ? (value as (current: CandidateData | null) => CandidateData | null)(current)
        : value;
      persistCandidateSession(next);
      return next;
    });
  };

  const refetchCandidateData = async () => {
    if (!candidateData?.email) return;
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/lookup?email=${encodeURIComponent(candidateData.email.trim())}`);
      if (response.ok) {
        const data = await response.json();
        updateCandidateData(prev => {
          if (!prev) return null;
          const applications = data.applications || [];
          const selectedApp = applications.find((app: any) => app.application_id === prev.selectedApplicationId)
            || applications.find((app: any) => app.position_id === prev.jobId)
            || applications[applications.length - 1];
          
          const status = selectedApp?.status || data.status;
          return {
            ...prev,
            ...data,
            status,
            applications,
            selectedApplicationId: selectedApp?.application_id || prev.selectedApplicationId,
            jobId: selectedApp?.position_id || prev.jobId,
            name: data.name ?? prev.name,
            profilePictureUrl: data.profile_picture_url ?? prev.profilePictureUrl,
            resumeUrl: data.resume_url ?? prev.resumeUrl,
            resumeSummary: data.resume_summary ?? prev.resumeSummary,
            profileVerified: data.profile_verified ?? prev.profileVerified,
            profileMissingFields: data.profile_missing_fields ?? prev.profileMissingFields ?? [],
            profileCompletion: data.profile_completion ?? prev.profileCompletion,
            age: data.profile_data?.age ?? prev.age,
            phone: data.profile_data?.phone ?? prev.phone,
            address: data.profile_data?.address ?? prev.address,
            cameFrom: data.profile_data?.came_from ?? prev.cameFrom,
            location: data.profile_data?.location ?? prev.location,
            headline: data.profile_data?.headline ?? prev.headline,
            about: data.profile_data?.about ?? prev.about,
            workExperience: data.profile_data?.work_experience ?? prev.workExperience,
            qualification: data.profile_data?.qualification ?? prev.qualification,
            gradeResults: data.profile_data?.grade_results ?? prev.gradeResults,
            awards: data.profile_data?.awards ?? prev.awards,
            skills: data.profile_data?.skills ?? prev.skills,
            experiences: data.profile_data?.experiences ?? prev.experiences,
            education: data.profile_data?.education ?? prev.education,
            notifications: data.notifications ?? prev.notifications
          };
        });
      }
    } catch (err) {
      console.error("Failed to refetch candidate status dynamically:", err);
    }
  };

  useEffect(() => {
    persistCandidateSession(candidateData);
  }, [candidateData]);

  useEffect(() => {
    if (!candidateData?.email) return;

    // Initial load refetch
    refetchCandidateData();

    // Dynanic live-polling sync every 5 seconds
    const interval = setInterval(() => {
      refetchCandidateData();
    }, 5000);

    return () => clearInterval(interval);
  }, [candidateData?.email]);

  const handleSignOut = () => updateCandidateData(null);

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
      <Routes>
        <Route
          index
          element={
            <CandidateLogin
              onAuthenticate={updateCandidateData}
            />
          }
        />
        <Route
          path="home"
          element={
            candidateData ? (
              <CandidatePageAppear pageKey={location.pathname}>
                <CandidateHome
                  candidateData={candidateData}
                  onUpdateCandidate={updateCandidateData}
                  onSignOut={handleSignOut}
                  view="overview"
                />
              </CandidatePageAppear>
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="applications"
          element={
            candidateData ? (
              <CandidatePageAppear pageKey={location.pathname}>
                <CandidateHome
                  candidateData={candidateData}
                  onUpdateCandidate={updateCandidateData}
                  onSignOut={handleSignOut}
                  view="applications"
                />
              </CandidatePageAppear>
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="jobs"
          element={
            candidateData ? (
              <CandidatePageAppear pageKey={location.pathname}>
                <CandidateHome
                  candidateData={candidateData}
                  onUpdateCandidate={updateCandidateData}
                  onSignOut={handleSignOut}
                  view="jobs"
                />
              </CandidatePageAppear>
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route path="information" element={<Navigate to="/candidate/profile" replace />} />
        <Route
          path="profile"
          element={
            candidateData ? (
              <CandidatePageAppear pageKey={location.pathname}>
                <CandidateInformation
                  candidateData={candidateData}
                  onUpdateCandidate={updateCandidateData}
                  onSignOut={handleSignOut}
                />
              </CandidatePageAppear>
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="apply-loading"
          element={
            candidateData ? (
              <CandidateApplyLoading
                candidateData={candidateData}
                onUpdateCandidate={updateCandidateData}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="new"
          element={
            candidateData ? (
              <CandidateLogin
                onAuthenticate={updateCandidateData}
                forceNewApplication
                initialEmail={candidateData.email}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="sandbox"
          element={
            candidateData?.jobId && candidateData.status !== 'completed' && candidateData.status !== 'hired' && candidateData.status !== 'rejected' && candidateData.status !== 'interview_scheduled' && !candidateData.lastAgentError ? (
              <CandidateSandbox
                candidateData={candidateData}
                onComplete={(answers, score, evaluation, agentWarnings = []) => {
                  const selectedPositionId = candidateData.jobId;
                  const selectedApplicationId = candidateData.selectedApplicationId;
                  updateCandidateData({
                    ...candidateData,
                    sandboxAnswers: answers,
                    score,
                    status: 'screening',
                    progress: 70,
                    evaluation,
                    agentWarnings: [...(candidateData.agentWarnings || []), ...agentWarnings],
                    applications: candidateData.applications?.map(application =>
                      application.application_id === selectedApplicationId || application.position_id === selectedPositionId
                        ? { ...application, status: 'screening', progress: 70, answers, evaluation, agent_warnings: agentWarnings }
                        : application
                    )
                  });
                }}
                onAgentError={(answers, message) => {
                  const selectedPositionId = candidateData.jobId;
                  const selectedApplicationId = candidateData.selectedApplicationId;
                  updateCandidateData({
                    ...candidateData,
                    sandboxAnswers: answers,
                    status: 'screening',
                    progress: 70,
                    lastAgentError: message,
                    applications: candidateData.applications?.map(application =>
                      application.application_id === selectedApplicationId || application.position_id === selectedPositionId
                        ? { ...application, status: 'screening', progress: 70, answers, draft_answers: answers, last_agent_error: message }
                        : application
                    )
                  });
                }}
              />
            ) : (
              <Navigate to={candidateData ? "/candidate/home" : "/candidate"} replace />
            )
          }
        />
        <Route
          path="feedback"
          element={
            candidateData ? (
              <CandidateFeedback
                candidateData={candidateData}
                onSignOut={handleSignOut}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
      </Routes>
    </div>
  );
}
