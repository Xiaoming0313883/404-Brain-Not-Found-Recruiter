import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router';
import { Briefcase, Users, BarChart3, ArrowLeft, LogOut, Calendar, UserCog } from 'lucide-react';
import { JobBuilder } from './hiring-manager/JobBuilder';
import { LinkedInScraper } from './hiring-manager/LinkedInScraper';
import { CandidateDashboard } from './hiring-manager/CandidateDashboard';
import { HiringManagerLogin } from './hiring-manager/HiringManagerLogin';
import { InterviewCalendar } from './hiring-manager/InterviewCalendar';
import { CandidateAccountsPage } from './hiring-manager/CandidateAccountsPage';
import { BrandLogo } from './BrandLogo';

export interface Job {
  id: number;
  title: string;
  department: string;
  description: string;
  requirements: string[];
  active: boolean;
  openTime?: string;
  endTime?: string;
  address?: string;
  applicationStatus?: 'open' | 'scheduled' | 'closed' | 'inactive';
  isOpenForApplications?: boolean;
  sourcingCriteria?: Record<string, any>;
  intakeChat?: Array<{ role: string; content: string }>;
  createdAt: string | Date;
}

export interface ScrapedCandidate {
  id: number;
  name: string;
  email: string;
  managementEmail: string;
  headline: string;
  location: string;
  about: string;
  experiences: Array<{
    title: string;
    company: string;
    duration: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
  }>;
  applicationId?: string;
  jobId: number;
  matchScore: number;
  trajectoryScore: number;
  positionFitSummary?: string;
  fitBreakdown?: any;
  scoreExplanation?: string;
  scoreContributors?: Array<{ factor: string; score: number; weight: number; impact: number; reason: string }>;
  status: 'staged' | 'invited' | 'applied' | 'screening' | 'completed' | 'hired' | 'rejected' | 'interview_scheduled';
  appliedAt?: string;
  recruitmentEmail?: string;
  sourcingPitch?: string;
  advocatePros?: string[];
  recruiterCons?: string[];
  screeningScore?: number;
  evaluation?: any;
  answers?: string[];
  resumeFilename?: string;
  resumeText?: string;
  resumeSummary?: string;
  resumeUrl?: string;
  profilePictureUrl?: string;
  sourceStatus?: string;
  sourceWarning?: string;
  sourceType?: string;
  sourceMethod?: string;
  phone?: string;
  age?: string;
  address?: string;
  cameFrom?: string;
  workExperience?: string;
  qualification?: string;
  gradeResults?: string;
  awards?: string[];
  skills?: string[];
  hrFeedback?: string;
  rejectionMessage?: string;
  rejectedAt?: string;
  hiredAt?: string;
  hasPassword?: boolean;
  emailVerified?: boolean;
  profileVerified?: boolean;
  applicationCount?: number;
  outreachHistory?: Array<{ id: string; sent_at: string; status: string; message: string; detail?: string; position_id?: number }>;
  interviewSlot?: {
    date: string;
    time: string;
    location: string;
    notes: string;
  };
  agentWarnings?: string[];
  lastAgentError?: string;
  statusHistory?: string[];
  biasControl?: {
    scoring_mode?: 'blind_merit' | 'prestige_aware';
    prestige_weight?: number;
    prestige_score?: number;
    prestige_affects_score?: boolean;
    explanation?: string;
  };
  prestigeAnalysis?: {
    prestige_score?: number;
    neutralization_summary?: string;
    prestige_indicators?: Array<{
      type: string;
      original: string;
      neutral_category: string;
      reason?: string;
    }>;
  };
  resumeContextIntelligence?: {
    high_potential_candidate?: boolean;
    undervalued_talent_alert?: boolean;
    signals?: string[];
  };
}

interface AuthUser {
  name: string;
  email: string;
  role: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export interface BiasControls {
  neutralize_prestige: boolean;
  anonymized_blind_hiring: boolean;
  scoring_mode: 'blind_merit' | 'prestige_aware';
  prestige_weight: number;
}

const DEFAULT_BIAS_CONTROLS: BiasControls = {
  neutralize_prestige: false,
  anonymized_blind_hiring: false,
  scoring_mode: 'blind_merit',
  prestige_weight: 15
};

const mapJobFromApi = (j: any): Job => ({
  ...j,
  active: j.active ?? true,
  openTime: j.open_time || '',
  endTime: j.end_time || '',
  address: j.address || '',
  applicationStatus: j.application_status || (j.active === false ? 'inactive' : 'open'),
  isOpenForApplications: j.is_open_for_applications ?? (j.active ?? true),
  sourcingCriteria: j.sourcing_criteria || {},
  intakeChat: j.intake_chat || [],
  createdAt: j.created_at ? new Date(j.created_at) : new Date('2026-01-15')
});

const toJobApiPayload = (job: Partial<Omit<Job, 'id' | 'createdAt'>>) => {
  const payload = {
    title: job.title,
    department: job.department,
    description: job.description,
    requirements: job.requirements,
    active: job.active,
    open_time: job.openTime,
    end_time: job.endTime,
    address: job.address,
    sourcing_criteria: job.sourcingCriteria,
    intake_chat: job.intakeChat
  };

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
};

export function HiringManagerPortal() {
  const location = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<ScrapedCandidate[]>([]);
  const [neutralizeActive, setNeutralizeActive] = useState(false);
  const [biasControls, setBiasControls] = useState<BiasControls>(DEFAULT_BIAS_CONTROLS);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch Jobs List
  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.map(mapJobFromApi));
      }
    } catch (err) {
      console.error("Failed to load jobs from API.");
    }
  };

  // Fetch Candidates List
  const fetchCandidates = async (neutralize: boolean = neutralizeActive) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/candidates?neutralize=${neutralize}`);
      if (res.ok) {
        const data = await res.json();
        
        const mapped: ScrapedCandidate[] = data.map((c: any, index: number) => ({
          id: c.id || index + 1,
          name: c.name,
          email: c.email,
          managementEmail: c.management_email || c.email,
          headline: c.profile_data?.headline || 'Software Engineer',
          location: c.profile_data?.location || '',
          about: c.profile_data?.about || '',
          experiences: c.profile_data?.experiences || [],
          education: c.profile_data?.education || [],
          applicationId: c.application_id,
          jobId: c.position_id,
          matchScore: c.match_results?.scores?.overall_position_fit || c.match_results?.scores?.technical || 80,
          trajectoryScore: c.match_results?.scores?.trajectory_slope || 80,
          positionFitSummary: c.match_results?.position_fit_summary || '',
          fitBreakdown: c.match_results?.fit_breakdown,
          scoreExplanation: c.match_results?.score_explanation || '',
          scoreContributors: c.match_results?.score_contributors || [],
          status: c.status,
          appliedAt: c.applied_at,
          recruitmentEmail: c.outreach_email,
          sourcingPitch: c.sourcing_pitch,
          advocatePros: c.match_results?.debate?.talent_advocate_pros || [],
          recruiterCons: c.match_results?.debate?.critical_recruiter_cons || [],
          screeningScore: c.evaluation?.screening_score,
          evaluation: c.evaluation,
          answers: c.answers || c.draft_answers || [],
          resumeFilename: c.resume_filename,
          resumeText: c.resume_text,
          resumeSummary: c.resume_summary,
          resumeUrl: c.resume_url,
          profilePictureUrl: c.profile_picture_url,
          sourceStatus: c.profile_data?.scrape_status || '',
          sourceWarning: c.profile_data?.scrape_warning || '',
          sourceType: c.source_type,
          sourceMethod: c.source_method,
          age: c.profile_data?.age || '',
          phone: c.profile_data?.phone || c.profile_data?.basic_info?.phone || '',
          address: c.profile_data?.address || '',
          cameFrom: c.profile_data?.came_from || '',
          workExperience: c.profile_data?.work_experience || '',
          qualification: c.profile_data?.qualification || '',
          gradeResults: c.profile_data?.grade_results || '',
          awards: c.profile_data?.awards || [],
          skills: c.profile_data?.skills || c.profile_data?.basic_info?.skills || [],
          hrFeedback: c.hr_feedback || '',
          rejectionMessage: c.rejection_message || '',
          rejectedAt: c.rejected_at,
          hiredAt: c.hired_at,
          hasPassword: Boolean(c.has_password),
          emailVerified: c.email_verified ?? true,
          profileVerified: Boolean(c.profile_verified),
          applicationCount: c.application_count || 0,
          outreachHistory: c.outreach_history || [],
          interviewSlot: c.interview_slot,
          agentWarnings: c.agent_warnings || [],
          lastAgentError: c.last_agent_error || '',
          statusHistory: c.status_history || [],
          biasControl: c.match_results?.bias_control,
          prestigeAnalysis: c.match_results?.prestige_analysis || c.bias_analysis,
          resumeContextIntelligence: c.match_results?.resume_context_intelligence
        }));
        setCandidates(mapped);
      }
    } catch (err) {
      console.error("Failed to load candidates from API.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authUser) {
      fetchJobs();
      fetchBiasControls().then(controls => fetchCandidates(controls.neutralize_prestige));
    }
  }, [authUser]);

  const fetchBiasControls = async (): Promise<BiasControls> => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/bias-controls`);
      if (res.ok) {
        const data = await res.json();
        const normalized = { ...DEFAULT_BIAS_CONTROLS, ...data };
        setBiasControls(normalized);
        setNeutralizeActive(normalized.neutralize_prestige);
        return normalized;
      }
    } catch (err) {
      console.error("Failed to load bias controls.");
    }
    return DEFAULT_BIAS_CONTROLS;
  };

  const updateBiasControls = async (updates: Partial<BiasControls>) => {
    const res = await fetch(`${API_BASE_URL}/settings/bias-controls`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to update bias controls.');
    }
    const data = await res.json();
    const normalized = { ...DEFAULT_BIAS_CONTROLS, ...data };
    setBiasControls(normalized);
    setNeutralizeActive(normalized.neutralize_prestige);
    await fetchCandidates(normalized.neutralize_prestige);
    return normalized;
  };

  const handleNeutralizeToggle = (active: boolean) => {
    updateBiasControls({ neutralize_prestige: active }).catch(error => console.error(error));
  };

  const addJob = async (job: Omit<Job, 'id' | 'createdAt'>) => {
    const res = await fetch(`${API_BASE_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toJobApiPayload(job))
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to save position.');
    }
    const data = await res.json();
    setJobs(prev => [...prev, mapJobFromApi(data)]);
  };

  const updateJob = async (jobId: number, updates: Partial<Omit<Job, 'id' | 'createdAt'>>) => {
    const res = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toJobApiPayload(updates))
    });
    if (!res.ok) throw new Error('Failed to update position.');
    const data = await res.json();
    setJobs(prev => prev.map(job => job.id === jobId ? mapJobFromApi(data) : job));
  };

  const deleteJob = async (jobId: number) => {
    const res = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to delete position.');
    }
    setJobs(prev => prev.filter(job => job.id !== jobId));
  };

  const addCandidate = (_candidate: ScrapedCandidate) => {
    fetchCandidates();
  };

  const updateCandidateStatus = (_candidateId: number, _status: ScrapedCandidate['status']) => {
    fetchCandidates();
  };

  const updateCandidateStatusByEmail = async (email: string, status: ScrapedCandidate['status'], positionId?: number) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, position_id: positionId })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to update candidate status.');
    }
    const data = await res.json().catch(() => null);
    await fetchCandidates();
    return data;
  };

  const revertCandidateStatusByEmail = async (email: string, positionId?: number) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/revert-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_id: positionId })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to revert candidate status.');
    }
    await fetchCandidates();
  };

  const inviteCandidateByEmail = async (email: string, outreachEmail?: string, hrFeedback?: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, outreach_email: outreachEmail, hr_feedback: hrFeedback })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to send candidate invitation.');
    }
    const data = await res.json();
    await fetchCandidates();
    return data;
  };

  const rejectCandidateByEmail = async (email: string, positionId?: number, hrFeedback?: string, rejectionMessage?: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_id: positionId, hr_feedback: hrFeedback || '', rejection_message: rejectionMessage })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to reject candidate.');
    }
    const data = await res.json().catch(() => null);
    await fetchCandidates();
    return data;
  };

  const deleteCandidateByEmail = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete candidate.');
    await fetchCandidates();
  };

  const updateCandidateAccountByEmail = async (email: string, updates: { emailVerified?: boolean; profileVerified?: boolean }) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/account`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_verified: updates.emailVerified,
        profile_verified: updates.profileVerified
      })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.detail || 'Failed to update candidate account.');
    }
    await fetchCandidates();
  };

  const resetCandidatePasswordByEmail = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.detail || 'Failed to reset candidate password.');
    }
    await fetchCandidates();
    return data?.temporary_password || '';
  };

  const scheduleInterviewByEmail = async (
    email: string,
    positionId: number | undefined,
    interviewDate: string,
    interviewTime: string,
    interviewLocation: string,
    interviewNotes?: string
  ) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/schedule-interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position_id: positionId,
        interview_date: interviewDate,
        interview_time: interviewTime,
        interview_location: interviewLocation,
        interview_notes: interviewNotes || ''
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.detail || 'Failed to schedule interview.');
    await fetchCandidates();
    return data;
  };

  const updateCandidateOutreachNotesByEmail = async (email: string, positionId?: number, outreachEmail?: string, hrFeedback?: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/outreach-notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_id: positionId, outreach_email: outreachEmail, hr_feedback: hrFeedback })
    });
    if (!res.ok) throw new Error('Failed to update outreach details and internal notes.');
    await fetchCandidates();
  };

  if (!authUser) {
    return <HiringManagerLogin onAuthenticate={setAuthUser} />;
  }

  const currentPath = location.pathname;

  const navItems = [
    { path: '/hiring-manager/jobs', label: 'Job Builder', icon: Briefcase },
    { path: '/hiring-manager/sourcing', label: 'LinkedIn Sourcing', icon: Users },
    { path: '/hiring-manager/dashboard', label: 'Overview', icon: BarChart3 },
    { path: '/hiring-manager/accounts', label: 'Candidate Accounts', icon: UserCog },
    { path: '/hiring-manager/calendar', label: 'Interview Calendar', icon: Calendar },
  ];

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
      <div className="bg-white border-b border-[#e4e1da] shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <BrandLogo imageClassName="h-14" />
                <h1 className="text-[#1c1c1a] text-lg font-semibold">Hiring Manager Portal</h1>
              </div>
              <p className="text-xs text-[#6b7063]">AI-Powered Recruitment Workspace</p>
            </div>
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#e8f2ee] flex items-center justify-center text-[#2d6a55] text-sm flex-shrink-0 font-medium">
                  {authUser.name.charAt(0)}
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-[#1c1c1a] leading-none mb-0.5 font-medium">{authUser.name}</p>
                  <p className="text-xs text-[#a8a49d]">{authUser.role}</p>
                </div>
              </div>
              <div className="w-px h-6 bg-[#e4e1da]" />
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">All Portals</span>
              </Link>
              <button
                onClick={() => setAuthUser(null)}
                className="inline-flex items-center gap-1.5 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b border-[#e4e1da] shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0">
            {navItems.map(({ path, label, icon: Icon }) => {
              const isActive = currentPath.includes(path.split('/').pop()!);
              return (
                <Link
                  key={path}
                  to={path}
                  className={`flex items-center gap-2 px-5 py-3.5 border-b-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-[#2d6a55] text-[#2d6a55]'
                      : 'border-transparent text-[#6b7063] hover:text-[#1c1c1a] hover:border-[#e4e1da]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/hiring-manager/jobs" replace />} />
          <Route path="/jobs" element={<JobBuilder jobs={jobs} candidates={candidates} onAddJob={addJob} onUpdateJob={updateJob} onDeleteJob={deleteJob} />} />
          <Route
            path="/sourcing"
            element={
              <LinkedInScraper
                jobs={jobs}
                candidates={candidates}
                onAddCandidate={addCandidate}
                onUpdateStatus={updateCandidateStatus}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <CandidateDashboard
                jobs={jobs}
                candidates={candidates}
                neutralize={neutralizeActive}
                onToggleNeutralize={handleNeutralizeToggle}
                biasControls={biasControls}
                onUpdateBiasControls={updateBiasControls}
                isLoading={isLoading}
                onRefresh={() => fetchCandidates()}
                onStatusChange={updateCandidateStatusByEmail}
                onInvite={inviteCandidateByEmail}
                onDelete={deleteCandidateByEmail}
                onReject={rejectCandidateByEmail}
                onScheduleInterview={scheduleInterviewByEmail}
                onUpdateOutreachNotes={updateCandidateOutreachNotesByEmail}
                onRevertStatus={revertCandidateStatusByEmail}
                view="overview"
              />
            }
          />
          <Route path="/candidates" element={<Navigate to="/hiring-manager/jobs" replace />} />
          <Route
            path="/accounts"
            element={
              <CandidateAccountsPage
                candidates={candidates}
                neutralize={neutralizeActive}
                isLoading={isLoading}
                onRefresh={() => fetchCandidates()}
                onDelete={deleteCandidateByEmail}
                onUpdateAccount={updateCandidateAccountByEmail}
                onResetPassword={resetCandidatePasswordByEmail}
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <InterviewCalendar
                jobs={jobs}
                candidates={candidates}
                onScheduleInterview={scheduleInterviewByEmail}
              />
            }
          />
        </Routes>
      </div>
    </div>
  );
}
