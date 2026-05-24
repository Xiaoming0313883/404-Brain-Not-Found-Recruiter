import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { CandidateLogin } from './candidate/CandidateLogin';
import { CandidateHome } from './candidate/CandidateHome';
import { CandidateSandbox } from './candidate/CandidateSandbox';
import { CandidateFeedback } from './candidate/CandidateFeedback';
import { CandidateInformation } from './candidate/CandidateInformation';
import { CandidateApplyLoading } from './candidate/CandidateApplyLoading';

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
}

const CANDIDATE_SESSION_KEY = 'candidateSessionV3';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export function CandidatePortal() {
  const [candidateData, setCandidateData] = useState<CandidateData | null>(() => {
    window.localStorage.removeItem('candidateSession');
    window.localStorage.removeItem('candidateSessionV2');
    const stored = window.localStorage.getItem(CANDIDATE_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  const refetchCandidateData = async () => {
    if (!candidateData?.email) return;
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/lookup?email=${encodeURIComponent(candidateData.email.trim())}`);
      if (response.ok) {
        const data = await response.json();
        setCandidateData(prev => {
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
    if (candidateData) {
      window.localStorage.setItem(CANDIDATE_SESSION_KEY, JSON.stringify(candidateData));
    } else {
      window.localStorage.removeItem(CANDIDATE_SESSION_KEY);
    }
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

  const handleSignOut = () => setCandidateData(null);

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
      <Routes>
        <Route
          path="/"
          element={
            <CandidateLogin
              onAuthenticate={setCandidateData}
            />
          }
        />
        <Route
          path="/home"
          element={
            candidateData ? (
              <CandidateHome
                candidateData={candidateData}
                onUpdateCandidate={setCandidateData}
                onSignOut={handleSignOut}
                view="overview"
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/applications"
          element={
            candidateData ? (
              <CandidateHome
                candidateData={candidateData}
                onUpdateCandidate={setCandidateData}
                onSignOut={handleSignOut}
                view="applications"
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/jobs"
          element={
            candidateData ? (
              <CandidateHome
                candidateData={candidateData}
                onUpdateCandidate={setCandidateData}
                onSignOut={handleSignOut}
                view="jobs"
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route path="/information" element={<Navigate to="/candidate/profile" replace />} />
        <Route
          path="/profile"
          element={
            candidateData ? (
              <CandidateInformation
                candidateData={candidateData}
                onUpdateCandidate={setCandidateData}
                onSignOut={handleSignOut}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/apply-loading"
          element={
            candidateData ? (
              <CandidateApplyLoading
                candidateData={candidateData}
                onUpdateCandidate={setCandidateData}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/new"
          element={
            candidateData ? (
              <CandidateLogin
                onAuthenticate={setCandidateData}
                forceNewApplication
                initialEmail={candidateData.email}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/sandbox"
          element={
            candidateData?.jobId && candidateData.status !== 'completed' && candidateData.status !== 'hired' && candidateData.status !== 'rejected' && candidateData.status !== 'interview_scheduled' && !candidateData.lastAgentError ? (
              <CandidateSandbox
                candidateData={candidateData}
                onComplete={(answers, score, evaluation, agentWarnings = []) => {
                  const selectedPositionId = candidateData.jobId;
                  const selectedApplicationId = candidateData.selectedApplicationId;
                  setCandidateData({
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
                  setCandidateData({
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
          path="/feedback"
          element={
            candidateData ? (
              <CandidateFeedback candidateData={candidateData} onSignOut={handleSignOut} />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
      </Routes>
    </div>
  );
}
