import { useState } from 'react';
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
  createdAt: Date;
}

export interface ScrapedCandidate {
  id: number;
  name: string;
  email: string;
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
  jobId: number;
  matchScore: number;
  trajectoryScore: number;
  status: 'staged' | 'invited' | 'applied' | 'screening' | 'completed';
  recruitmentEmail?: string;
  advocatePros?: string[];
  recruiterCons?: string[];
  screeningScore?: number;
}

interface AuthUser {
  name: string;
  email: string;
  role: string;
}

export function HiringManagerPortal() {
  const location = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [jobs, setJobs] = useState<Job[]>([
    {
      id: 1,
      title: 'Senior Full-Stack Engineer',
      department: 'Engineering',
      description: 'We are seeking an experienced full-stack engineer to build scalable distributed systems.',
      requirements: ['5+ years experience', 'React & Node.js', 'Distributed systems'],
      createdAt: new Date('2024-01-15')
    }
  ]);

  const [candidates, setCandidates] = useState<ScrapedCandidate[]>([
    {
      id: 1,
      name: 'Sarah Chen',
      email: 'sarah.chen@email.com',
      headline: 'Senior Software Engineer @ Tech Corp',
      location: 'San Francisco, CA',
      about: 'Passionate about building scalable distributed systems. 8 years of experience in full-stack development with focus on microservices architecture.',
      experiences: [
        { title: 'Senior Software Engineer', company: '[Tier-1 Tech Corporation]', duration: '2020-Present' },
        { title: 'Software Engineer', company: '[Series B Startup]', duration: '2017-2020' }
      ],
      education: [
        { school: '[Top 20 State University]', degree: 'BS Computer Science' }
      ],
      jobId: 1,
      matchScore: 85,
      trajectoryScore: 92,
      status: 'invited',
      advocatePros: [
        'Exceptional trajectory — moved from junior to senior in 3 years',
        'Strong open-source contributions in distributed systems',
        'Demonstrated leadership in architectural decisions'
      ],
      recruiterCons: [
        'No direct experience with our specific tech stack',
        'May require relocation support'
      ],
      recruitmentEmail: `Dear Sarah,\n\nWe've been following your impressive career trajectory...\n\nBest regards,\nThe Hiring Team`,
      screeningScore: 78
    }
  ]);

  const addJob = (job: Omit<Job, 'id' | 'createdAt'>) => {
    setJobs([...jobs, {
      ...job,
      id: jobs.length + 1,
      createdAt: new Date()
    }]);
  };

  const addCandidate = (candidate: Omit<ScrapedCandidate, 'id'>) => {
    setCandidates([...candidates, {
      ...candidate,
      id: candidates.length + 1
    }]);
  };

  const updateCandidateStatus = (candidateId: number, status: ScrapedCandidate['status']) => {
    setCandidates(candidates.map(c => c.id === candidateId ? { ...c, status } : c));
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
      <div className="bg-white border-b border-[#e4e1da]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <div className="w-6 h-6 rounded bg-[#2d6a55] flex items-center justify-center">
                  <Briefcase className="w-3.5 h-3.5 text-white" />
                </div>
                <h1 className="text-[#1c1c1a]">Hiring Manager Portal</h1>
              </div>
              <p className="text-xs text-[#6b7063] ml-9">AI-Powered Recruitment Workspace</p>
            </div>
            <div className="flex items-center gap-5">
              {/* User identity */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#e8f2ee] flex items-center justify-center text-[#2d6a55] text-sm flex-shrink-0">
                  {authUser.name.charAt(0)}
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-[#1c1c1a] leading-none mb-0.5">{authUser.name}</p>
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
                className="inline-flex items-center gap-1.5 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors"
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
      <div className="bg-white border-b border-[#e4e1da]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0">
            {navItems.map(({ path, label, icon: Icon }) => {
              const isActive = currentPath.includes(path.split('/').pop()!);
              return (
                <Link
                  key={path}
                  to={path}
                  className={`flex items-center gap-2 px-5 py-3.5 border-b-2 text-sm transition-colors ${
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
          <Route path="/jobs" element={<JobBuilder jobs={jobs} onAddJob={addJob} />} />
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
              />
            }
          />
        </Routes>
      </div>
    </div>
  );
}
