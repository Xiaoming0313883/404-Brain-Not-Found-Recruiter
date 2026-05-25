import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as Progress from '@radix-ui/react-progress';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateData } from '../CandidatePortal';
import { API_BASE_URL } from '../../api';

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
    const steps = [
      [25, 'Reading your candidate profile...'],
      [48, 'Matching your profile to the position...'],
      [72, 'Preparing personalized screening questions...'],
      [90, 'Finalizing interview workspace...']
    ] as const;
    steps.forEach(([value, text], index) => {
      window.setTimeout(() => {
        if (!cancelled) {
          setProgress(value);
          setMessage(text);
        }
      }, 450 + index * 650);
    });

    const run = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/apply-position`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position_id: position.id })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.detail || 'Failed to apply for this position.');
        }
        const normalizedApplications = (data.applications || []).map((application: any) => ({
          ...application,
          status: application.status === 'invited' || application.status === 'staged' ? 'sourced' : application.status,
          progress: application.progress ?? 40
        }));
        const selectedApplication = normalizedApplications.find((application: any) => application.position_id === position.id);
        onUpdateCandidate({
          ...candidateData,
          jobId: position.id,
          selectedApplicationId: data.application_id || selectedApplication?.application_id,
          position: position.title,
          status: 'applied',
          progress: 40,
          applications: normalizedApplications,
          customQuestions: data.custom_questions,
          sandboxAnswers: data.answers || [],
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
        <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-2 font-semibold">Application Progress</p>
        <h1 className="text-2xl text-[#1c1c1a] font-semibold mb-2">{position?.title || 'Selected position'}</h1>
        <p className="text-sm text-[#6b7063] mb-6">{message}</p>
        <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-2 w-full">
          <Progress.Indicator className="bg-[#2d6a55] h-full transition-transform duration-500" style={{ transform: `translateX(-${100 - progress}%)`, width: '100%' }} />
        </Progress.Root>
        <p className="text-xs text-[#2d6a55] font-semibold mt-3">{progress}%</p>
        {errorMessage && (
          <div className="mt-6 rounded-xl border border-[#f5c2c2] bg-[#fdf2f2] p-4 text-sm text-[#b91c1c]">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
