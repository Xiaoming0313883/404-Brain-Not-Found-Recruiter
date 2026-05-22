import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { CandidateLogin } from './candidate/CandidateLogin';
import { CandidateSandbox } from './candidate/CandidateSandbox';
import { CandidateFeedback } from './candidate/CandidateFeedback';

export interface CandidateData {
  email: string;
  name: string;
  position: string;
  status: 'sourced' | 'applied' | 'screening' | 'completed';
  progress: number;
  isInvited: boolean;
  resumeData?: any;
  sandboxAnswers?: string[];
  score?: number;
  recruitmentEmail?: string;
}

export function CandidatePortal() {
  const [candidateData, setCandidateData] = useState<CandidateData | null>(null);

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
          path="/sandbox"
          element={
            candidateData ? (
              <CandidateSandbox
                candidateData={candidateData}
                onComplete={(answers, score) => {
                  setCandidateData({
                    ...candidateData,
                    sandboxAnswers: answers,
                    score,
                    status: 'completed',
                    progress: 100
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
