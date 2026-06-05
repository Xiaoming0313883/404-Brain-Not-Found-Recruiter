import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { API_BASE_URL } from '../api';
import { BrandLogo } from './BrandLogo';

type ResetState = 'resetting' | 'success' | 'error';

export function DemoReset() {
  const [state, setState] = useState<ResetState>('resetting');
  const [message, setMessage] = useState('Resetting demo data...');
  const [deleted, setDeleted] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const resetDemo = async () => {
      setState('resetting');
      setMessage('Resetting demo data...');
      setDeleted({});
      window.localStorage.removeItem('candidateSession');
      window.localStorage.removeItem('candidateSessionV2');
      window.localStorage.removeItem('candidateSessionV3');
      window.localStorage.removeItem('hiringManagerSessionV1');

      try {
        const response = await fetch(`${API_BASE_URL}/demo/reset`, { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.detail || 'Demo reset failed.');
        }
        if (cancelled) return;
        setDeleted(payload.deleted || {});
        setMessage(payload.message || 'Demo data reset.');
        setState('success');
      } catch (error: any) {
        if (cancelled) return;
        setMessage(error.message || 'Demo reset failed.');
        setState('error');
      }
    };

    resetDemo();
    return () => {
      cancelled = true;
    };
  }, []);

  const deletedCount = Object.values(deleted).reduce((total, count) => total + count, 0);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f7f6f3]">
      <div className="max-w-lg w-full bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm">
        <BrandLogo className="justify-center mb-6" imageClassName="h-16" />
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            state === 'error' ? 'bg-[#fdf2f2]' : 'bg-[#e8f2ee]'
          }`}>
            {state === 'resetting' && <Loader2 className="w-5 h-5 text-[#2d6a55] animate-spin" />}
            {state === 'success' && <CheckCircle2 className="w-5 h-5 text-[#2d6a55]" />}
            {state === 'error' && <TriangleAlert className="w-5 h-5 text-[#b91c1c]" />}
          </div>
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-2 font-semibold">Demo Reset</p>
            <h1 className="text-xl text-[#1c1c1a] font-semibold mb-2">
              {state === 'resetting' ? 'Preparing demo workspace' : state === 'success' ? 'Demo workspace ready' : 'Reset needs attention'}
            </h1>
            <p className="text-sm text-[#6b7063] leading-relaxed">{message}</p>
            {state === 'success' && (
              <p className="text-xs text-[#a8a49d] mt-3">
                Cleared {deletedCount} Supabase demo {deletedCount === 1 ? 'record' : 'records'}. The Software Engineer job is created from the hiring manager portal.
              </p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          <Link
            to="/hiring-manager"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Hiring Manager
          </Link>
          <Link
            to="/candidate"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium"
          >
            Candidate Portal
          </Link>
        </div>
      </div>
    </div>
  );
}
