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

export function CandidatePortal() {
  const [candidateData, setCandidateData] = useState<CandidateData | null>(() => {
    window.localStorage.removeItem('candidateSession');
    window.localStorage.removeItem('candidateSessionV2');
    const stored = window.localStorage.getItem(CANDIDATE_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (candidateData) {
      window.localStorage.setItem(CANDIDATE_SESSION_KEY, JSON.stringify(candidateData));
    } else {
      window.localStorage.removeItem(CANDIDATE_SESSION_KEY);
    }
  }, [candidateData]);

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
