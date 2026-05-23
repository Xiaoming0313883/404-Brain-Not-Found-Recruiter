import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router';
import { Briefcase, Users, BarChart3, ArrowLeft, LogOut } from 'lucide-react';
import { JobBuilder } from './hiring-manager/JobBuilder';
import { LinkedInScraper } from './hiring-manager/LinkedInScraper';
import { CandidateDashboard } from './hiring-manager/CandidateDashboard';
import { HiringManagerLogin } from './hiring-manager/HiringManagerLogin';

export interface Job {
  id: number;
  title: string;
  department: string;
  description: string;
  requirements: string[];
  active: boolean;
  openTime?: string;
  endTime?: string;
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
  status: 'staged' | 'invited' | 'applied' | 'screening' | 'completed';
  appliedAt?: string;
  recruitmentEmail?: string;
  sourcingPitch?: string;
  advocatePros?: string[];
  recruiterCons?: string[];
  screeningScore?: number;
  evaluation?: any;
  resumeFilename?: string;
  resumeText?: string;
  resumeSummary?: string;
  resumeUrl?: string;
  profilePictureUrl?: string;
}

interface AuthUser {
  name: string;
  email: string;
  role: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const mapJobFromApi = (j: any): Job => ({
  ...j,
  active: j.active ?? true,
  openTime: j.open_time || '',
  endTime: j.end_time || '',
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

  // Fetch Candidates List (supports dynamic prestige neutralization filters)
  const fetchCandidates = async (neutralize: boolean = neutralizeActive) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/candidates?neutralize=${neutralize}`);
      if (res.ok) {
        const data = await res.json();
        
        // Map backend schemas to react ScrapedCandidate schemas
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
          matchScore: c.match_results?.scores?.technical || 80,
          trajectoryScore: c.match_results?.scores?.trajectory_slope || 80,
          status: c.status,
          appliedAt: c.applied_at,
          recruitmentEmail: c.outreach_email,
          sourcingPitch: c.sourcing_pitch,
          advocatePros: c.match_results?.debate?.talent_advocate_pros || [],
          recruiterCons: c.match_results?.debate?.critical_recruiter_cons || [],
          screeningScore: c.evaluation?.screening_score,
          evaluation: c.evaluation,
          resumeFilename: c.resume_filename,
          resumeText: c.resume_text,
          resumeSummary: c.resume_summary,
          resumeUrl: c.resume_url,
          profilePictureUrl: c.profile_picture_url
        }));
        setCandidates(mapped);
      }
    } catch (err) {
      console.error("Failed to load candidates from API.");
    } finally {
      setIsLoading(false);
    }
  };

  // Load everything on mount and when authentication status changes
  useEffect(() => {
    if (authUser) {
      fetchJobs();
      fetchCandidates();
    }
  }, [authUser]);

  // Handler to fetch candidates dynamically when neutralize toggle changes
  const handleNeutralizeToggle = (active: boolean) => {
    setNeutralizeActive(active);
    fetchCandidates(active);
  };

  const addJob = async (job: Omit<Job, 'id' | 'createdAt'>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toJobApiPayload(job))
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(prev => [...prev, mapJobFromApi(data)]);
      }
    } catch (err) {
      console.error("Failed to save job to API.");
    }
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

  const addCandidate = (_candidate: ScrapedCandidate) => {
    // Re-fetch candidates list to ensure synchronicity with JSON file
    fetchCandidates();
  };

  const updateCandidateStatus = (_candidateId: number, _status: ScrapedCandidate['status']) => {
    fetchCandidates();
  };

  const updateCandidateStatusByEmail = async (email: string, status: ScrapedCandidate['status']) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update candidate status.');
    await fetchCandidates();
  };

  const inviteCandidateByEmail = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Failed to send candidate invitation.');
    await fetchCandidates();
  };

  const deleteCandidateByEmail = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete candidate.');
    await fetchCandidates();
  };

  if (!authUser) {
    return <HiringManagerLogin onAuthenticate={setAuthUser} />;
  }

  const currentPath = location.pathname;

  const navItems = [
    { path: '/hiring-manager/jobs', label: 'Job Builder', icon: Briefcase },
    { path: '/hiring-manager/sourcing', label: 'LinkedIn Sourcing', icon: Users },
    { path: '/hiring-manager/dashboard', label: 'Candidate Pipeline', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
      {/* Top Navigation */}
      <div className="bg-white border-b border-[#e4e1da] shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <div className="w-6 h-6 rounded bg-[#2d6a55] flex items-center justify-center">
                  <Briefcase className="w-3.5 h-3.5 text-white" />
                </div>
                <h1 className="text-[#1c1c1a] text-lg font-semibold">Hiring Manager Portal</h1>
              </div>
              <p className="text-xs text-[#6b7063] ml-9">AI-Powered Recruitment Workspace</p>
            </div>
            <div className="flex items-center gap-5">
              {/* User identity */}
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

      {/* Tab Navigation */}
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

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/hiring-manager/jobs" replace />} />
          <Route path="/jobs" element={<JobBuilder jobs={jobs} candidates={candidates} onAddJob={addJob} onUpdateJob={updateJob} />} />
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
                isLoading={isLoading}
                onRefresh={() => fetchCandidates()}
                onStatusChange={updateCandidateStatusByEmail}
                onInvite={inviteCandidateByEmail}
                onDelete={deleteCandidateByEmail}
              />
            }
          />
        </Routes>
      </div>
    </div>
  );
}
