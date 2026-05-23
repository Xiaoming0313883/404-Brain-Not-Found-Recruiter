import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { CandidateLogin } from './candidate/CandidateLogin';
import { CandidateHome } from './candidate/CandidateHome';
import { CandidateSandbox } from './candidate/CandidateSandbox';
import { CandidateFeedback } from './candidate/CandidateFeedback';

export interface CandidateData {
  email: string;
  name: string;
  position: string;
  jobId?: number;
  selectedApplicationId?: string;
  applications?: Array<{
    application_id: string;
    position_id: number;
    status: 'profile' | 'sourced' | 'applied' | 'screening' | 'completed';
    applied_at?: string;
    progress?: number;
    custom_questions?: string[];
    answers?: string[];
    evaluation?: any;
    match_results?: any;
  }>;
  status: 'profile' | 'sourced' | 'applied' | 'screening' | 'completed';
  progress: number;
  isInvited: boolean;
  appliedAt?: string;
  profilePictureUrl?: string;
  resumeUrl?: string;
  resumeSummary?: string;
  resumeData?: any;
  sandboxAnswers?: string[];
  score?: number;
  recruitmentEmail?: string;
  customQuestions?: string[];
  evaluation?: any;
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
            candidateData ? (
              <CandidateSandbox
                candidateData={candidateData}
                onComplete={(answers, score, evaluation) => {
                  const selectedPositionId = candidateData.jobId;
                  setCandidateData({
                    ...candidateData,
                    sandboxAnswers: answers,
                    score,
                    status: 'completed',
                    progress: 100,
                    evaluation,
                    applications: candidateData.applications?.map(application =>
                      application.position_id === selectedPositionId
                        ? { ...application, status: 'completed', progress: 100, answers, evaluation }
                        : application
                    )
                  });
                }}
              />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
        <Route
          path="/feedback"
          element={
            candidateData?.status === 'completed' ? (
              <CandidateFeedback candidateData={candidateData} />
            ) : (
              <Navigate to="/candidate" replace />
            )
          }
        />
      </Routes>
    </div>
  );
}
