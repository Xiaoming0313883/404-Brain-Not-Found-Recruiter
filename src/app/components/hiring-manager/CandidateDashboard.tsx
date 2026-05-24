import { useState, useMemo, useRef } from 'react';
import { Job, ScrapedCandidate } from '../HiringManagerPortal';
import {
  Users,
  Briefcase,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  AlertCircle,
  ChevronDown,
  ShieldCheck,
  Loader2,
  Mail,
  RefreshCcw,
  Trash2,
  UserCheck,
  UserCog,
  KeyRound,
  XCircle,
  X,
  Calendar,
  RotateCcw,
  FileSpreadsheet
} from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import * as Accordion from '@radix-ui/react-accordion';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { PdfResumeViewer } from '../PdfResumeViewer';

const getCandidatePhase = (status: string, answers?: string[]): string => {
  if (status === 'hired') return 'Hired';
  if (status === 'rejected') return 'Rejected';
  if (status === 'interview_scheduled') return 'Interview In Progress';
  if (status === 'completed') return 'Waiting for Interview';
  if (status === 'screening' || (answers && answers.length > 0)) return 'Screening Completed';
  return 'Waiting for Screening';
};

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  neutralize: boolean;
  onToggleNeutralize: (active: boolean) => void;
  isLoading?: boolean;
  onRefresh: () => Promise<void> | void;
  onStatusChange: (email: string, status: ScrapedCandidate['status'], positionId?: number) => Promise<void>;
  onInvite: (email: string, outreachEmail?: string, hrFeedback?: string) => Promise<any>;
  onDelete: (email: string) => Promise<void>;
  onReject: (email: string, positionId?: number, hrFeedback?: string, rejectionMessage?: string) => Promise<void>;
  onScheduleInterview: (email: string, positionId: number | undefined, date: string, time: string, location: string, notes?: string) => Promise<any>;
  onUpdateOutreachNotes: (email: string, positionId?: number, outreachEmail?: string, hrFeedback?: string) => Promise<void>;
  onRevertStatus?: (email: string, positionId?: number) => Promise<void>;
  view?: 'overview' | 'candidates';
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

// Predefined outreach templates for Feature 6
const OUTREACH_TEMPLATES = [
  {
    label: 'Tech / Software',
    emoji: '💻',
    generate: (name: string, jobTitle: string) =>
      `Hi ${name},\n\nI came across your profile and was genuinely impressed by your background. We're building something exciting here and your experience feels like a strong match for the ${jobTitle} role we currently have open.\n\nOur team is collaborative, technically driven, and moves fast. We're strong believers in remote-first culture, continuous learning, and giving engineers real ownership of the product.\n\nWould love to set aside 20 minutes to chat about what we're working on and whether it might be the right fit for you. Keen to hear more?\n\nBest regards,\nThe Talent Team`
  },
  {
    label: 'Operations / General',
    emoji: '🏢',
    generate: (name: string, jobTitle: string) =>
      `Hi ${name},\n\nThank you for your interest in the ${jobTitle} position at our company. We reviewed your profile carefully and believe your practical experience makes you a strong candidate for this role.\n\nWe are a fast-growing team focused on building reliable, people-first operations. The ${jobTitle} role plays a key part in supporting our day-to-day success and long-term growth plans.\n\nWe would love to learn more about your background and share more about the opportunity. Please let us know a convenient time to connect.\n\nWarm regards,\nThe Recruiting Team`
  },
  {
    label: 'Senior / Leadership',
    emoji: '🌟',
    generate: (name: string, jobTitle: string) =>
      `Hi ${name},\n\nYour career trajectory stood out to us — particularly the way you've consistently moved into roles with broader impact and responsibility. We're currently searching for the right person to take on the ${jobTitle} position, and your profile came up as a compelling match.\n\nThis is a leadership role where you'd be setting direction, mentoring a growing team, and working closely with senior stakeholders. We're looking for someone who leads with clarity, earns trust quickly, and sees the bigger picture.\n\nI'd welcome the chance to speak with you directly. Would you be open to a brief exploratory call?\n\nWith respect,\nThe Executive Search Team`
  }
];

const getVisiblePages = (currentPage: number, totalPages: number) => {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return Array.from(pages)
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
};

const alignScoreMentions = (text: string, score: any) => {
  if (score === undefined || score === null || text === undefined || text === null) return text;
  return String(text)
    .replace(/(answer\s+scored\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(score\s+is\s+)(\d+(?:\.\d+)?)(\/100)/i, `$1${score}$3`)
    .replace(/(scored\s+)(\d+(?:\.\d+)?)(\s*out\s+of\s+100)/i, `$1${score}$3`);
};

export function CandidateDashboard({
  jobs,
  candidates,
  neutralize,
  onToggleNeutralize,
  isLoading,
  onRefresh,
  onStatusChange: onStatusChangeProp,
  onInvite: onInviteProp,
  onDelete,
  onReject: onRejectProp,
  onScheduleInterview: onScheduleInterviewProp,
  onUpdateOutreachNotes,
  onRevertStatus,
  view = 'overview'
}: Props) {
  const [anonymizedMode, setAnonymizedMode] = useState(false);
  const [busyEmail, setBusyEmail] = useState('');
  const actionLocksRef = useRef<Set<string>>(new Set());
  const [actionError, setActionError] = useState('');
  const [selectedPositionId, setSelectedPositionId] = useState<number | 'all'>('all');
  const [selectedTrajectoryCandidate, setSelectedTrajectoryCandidate] = useState<ScrapedCandidate | null>(null);

  const [lastActionCandidate, setLastActionCandidate] = useState<{ email: string; name: string; oldStatus: string; newStatus: string; jobId?: number } | null>(null);

  const onStatusChange = async (email: string, newStatus: ScrapedCandidate['status'], jobId?: number) => {
    const candidate = candidates.find(c => getActionEmail(c).toLowerCase() === email.toLowerCase());
    if (candidate) {
      setLastActionCandidate({
        email,
        name: candidate.name,
        oldStatus: candidate.status,
        newStatus,
        jobId
      });
    }
    await onStatusChangeProp(email, newStatus, jobId);
  };

  const onInvite = async (email: string, outreachEmail?: string, hrFeedback?: string) => {
    const candidate = candidates.find(c => getActionEmail(c).toLowerCase() === email.toLowerCase());
    if (candidate) {
      setLastActionCandidate({
        email,
        name: candidate.name,
        oldStatus: candidate.status,
        newStatus: 'invited',
        jobId: candidate.jobId
      });
    }
    return onInviteProp(email, outreachEmail, hrFeedback);
  };

  const onReject = async (email: string, positionId?: number, hrFeedback?: string, rejectionMessage?: string) => {
    const candidate = candidates.find(c => getActionEmail(c).toLowerCase() === email.toLowerCase());
    if (candidate) {
      setLastActionCandidate({
        email,
        name: candidate.name,
        oldStatus: candidate.status,
        newStatus: 'rejected',
        jobId: positionId
      });
    }
    await onRejectProp(email, positionId, hrFeedback, rejectionMessage);
  };

  const onScheduleInterview = async (email: string, positionId: number | undefined, date: string, time: string, location: string, notes?: string) => {
    const candidate = candidates.find(c => getActionEmail(c).toLowerCase() === email.toLowerCase());
    if (candidate) {
      setLastActionCandidate({
        email,
        name: candidate.name,
        oldStatus: candidate.status,
        newStatus: 'interview_scheduled',
        jobId: positionId
      });
    }
    return onScheduleInterviewProp(email, positionId, date, time, location, notes);
  };

  const openPdfInBrowser = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank');
      if (!win) window.open(url, '_blank');
    } catch {
      window.open(url, '_blank');
    }
  };

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'match' | 'match-asc' | 'velocity' | 'name'>('match');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'all' | 'verified' | 'unverified' | 'password_set' | 'password_missing'>('all');
  const [passwordResetMessage, setPasswordResetMessage] = useState('');
  const pageSize = 10;

  const [editedOutreach, setEditedOutreach] = useState<Record<string, string>>({});
  const [editedFeedback, setEditedFeedback] = useState<Record<string, string>>({});
  const [isSavingField, setIsSavingField] = useState<Record<string, boolean>>({});
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState<string>('');

  const [rejectTarget, setRejectTarget] = useState<ScrapedCandidate | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState<string>('');
  const [rejectMessage, setRejectMessage] = useState<string>('');

  const [openMarkDropdown, setOpenMarkDropdown] = useState<string>('');

  const [scheduleTarget, setScheduleTarget] = useState<ScrapedCandidate | null>(null);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleTime, setScheduleTime] = useState<string>('');
  const [scheduleLocation, setScheduleLocation] = useState<string>('To be confirmed');
  const [scheduleNotes, setScheduleNotes] = useState<string>('');

  const activePositions = jobs.filter(job => job.isOpenForApplications).length;
  const selectedJob = selectedPositionId === 'all' ? null : jobs.find(job => job.id === selectedPositionId);
  const scopedCandidates = useMemo(() => {
    return selectedPositionId === 'all'
      ? candidates
      : candidates.filter(candidate => candidate.jobId === selectedPositionId);
  }, [candidates, selectedPositionId]);
  const totalCandidates = scopedCandidates.length;
  const screeningCompleted = scopedCandidates.filter(c => c.status === 'completed').length;
  const hiredCandidates = scopedCandidates.filter(c => c.status === 'hired').length;
  const activePipelineCount = scopedCandidates.filter(c => c.status !== 'hired' && c.status !== 'rejected').length;
  const averageMatch = totalCandidates
    ? Math.round(scopedCandidates.reduce((sum, candidate) => sum + candidate.matchScore, 0) / totalCandidates)
    : 0;

  const positionStats = useMemo(() => {
    return jobs.map(job => {
      const pool = candidates.filter(candidate => candidate.jobId === job.id);
      const completed = pool.filter(candidate => candidate.status === 'completed').length;
      const hired = pool.filter(candidate => candidate.status === 'hired').length;
      const average = pool.length
        ? Math.round(pool.reduce((sum, candidate) => sum + candidate.matchScore, 0) / pool.length)
        : 0;
      return { job, pool, completed, hired, average };
    });
  }, [jobs, candidates]);

  const scatterData = useMemo(() => {
    return scopedCandidates.map(c => ({
      name: anonymizedMode ? `Candidate #${c.id.toString().padStart(4, '0')}` : c.name,
      matchScore: c.matchScore,
      trajectoryScore: c.trajectoryScore,
      candidate: c
    }));
  }, [scopedCandidates, anonymizedMode]);

  const neutralizeText = (text: string): string => {
    if (!neutralize) return text;
    const replacements = [
      { pattern: /Google|Facebook|Meta|Apple|Amazon|Microsoft|Netflix/gi, replacement: '[Tier-1 Tech Corporation]' },
      { pattern: /McKinsey|BCG|Bain/gi, replacement: '[Tier-1 Consulting Firm]' },
      { pattern: /Goldman Sachs|Morgan Stanley|JP Morgan/gi, replacement: '[Tier-1 Investment Bank]' },
      { pattern: /Harvard|Yale|Stanford|MIT|Princeton/gi, replacement: '[Tier-1 Research University]' },
      { pattern: /Berkeley|UCLA|Michigan|Cornell/gi, replacement: '[Top 20 State University]' },
    ];
    let result = text;
    replacements.forEach(({ pattern, replacement }) => {
      result = result.replace(pattern, replacement);
    });
    return result;
  };

  const getDisplayName = (candidate: ScrapedCandidate): string =>
    anonymizedMode ? `Candidate #${candidate.id.toString().padStart(4, '0')}` : candidate.name;

  const getDisplayEmail = (candidate: ScrapedCandidate): string =>
    anonymizedMode ? `candidate${candidate.id}@anonymized.local` : candidate.email;

  const getActionEmail = (candidate: ScrapedCandidate): string =>
    candidate.managementEmail || candidate.email;

  const candidateAccounts = useMemo(() => {
    const accounts = new Map<string, ScrapedCandidate>();
    candidates.forEach(candidate => {
      const emailKey = getActionEmail(candidate).toLowerCase();
      const existing = accounts.get(emailKey);
      if (!existing) {
        accounts.set(emailKey, candidate);
        return;
      }
      if ((candidate.applicationCount || 0) > (existing.applicationCount || 0)) {
        accounts.set(emailKey, candidate);
      }
    });
    return Array.from(accounts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return candidateAccounts.filter(candidate => {
      const matchesQuery = !query
        || candidate.name.toLowerCase().includes(query)
        || getActionEmail(candidate).toLowerCase().includes(query);
      const matchesFilter =
        accountFilter === 'all'
        || (accountFilter === 'verified' && candidate.emailVerified)
        || (accountFilter === 'unverified' && !candidate.emailVerified)
        || (accountFilter === 'password_set' && candidate.hasPassword)
        || (accountFilter === 'password_missing' && !candidate.hasPassword);
      return matchesQuery && matchesFilter;
    });
  }, [accountFilter, accountSearch, candidateAccounts]);

  // Filter candidates based on selected status pill
  const filteredCandidates = useMemo(() => {
    return filterStatus === 'all'
      ? scopedCandidates
      : scopedCandidates.filter(c => c.status === filterStatus);
  }, [scopedCandidates, filterStatus]);

  // Sort candidates based on active sort setting
  const sortedCandidates = useMemo(() => {
    return [...filteredCandidates].sort((a, b) => {
      if (sortBy === 'match') {
        return b.matchScore - a.matchScore;
      }
      if (sortBy === 'match-asc') {
        return a.matchScore - b.matchScore;
      }
      if (sortBy === 'velocity') {
        return b.trajectoryScore - a.trajectoryScore;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
  }, [filteredCandidates, sortBy]);

  const totalFiltered = sortedCandidates.length;
  const totalPages = Math.ceil(totalFiltered / pageSize);
  const visiblePages = getVisiblePages(currentPage, totalPages);

  // Paginate sorted & filtered candidates
  const paginatedCandidates = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedCandidates.slice(start, start + pageSize);
  }, [sortedCandidates, currentPage, pageSize]);

  const runAction = async (email: string, action: () => Promise<void> | void) => {
    if (actionLocksRef.current.has(email)) return;
    actionLocksRef.current.add(email);
    setBusyEmail(email);
    setActionError('');
    try {
      return await action();
    } catch (error: any) {
      setActionError(error.message || 'Candidate action failed.');
      toast.error(error.message || 'Candidate action failed.');
    } finally {
      window.setTimeout(() => {
        actionLocksRef.current.delete(email);
        setBusyEmail(current => current === email ? '' : current);
      }, 900);
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-[#e4e1da] p-4 rounded-xl shadow-lg font-sans">
          <p className="text-sm text-[#1c1c1a] mb-2 font-semibold">{data.name}</p>
          <div className="space-y-1">
            <div className="flex justify-between gap-4 text-xs font-medium">
              <span className="text-[#6b7063]">Position Fit</span>
              <span className="text-[#2d6a55]">{data.matchScore}%</span>
            </div>
            <div className="flex justify-between gap-4 text-xs font-medium">
              <span className="text-[#6b7063]">Trajectory</span>
              <span className="text-[#c9a84c]">{data.trajectoryScore}%</span>
            </div>
            <p className="text-[10px] text-[#a8a49d] pt-1">Click to open candidate profile</p>
          </div>
        </div>
      );
    }
    return null;
  };

  const kpiCards = [
    { label: selectedJob ? 'Selected Position Pool' : 'Active Positions', value: selectedJob ? totalCandidates : activePositions, icon: Briefcase },
    { label: 'Active Pipeline', value: activePipelineCount, icon: Users },
    { label: 'Screening Completed', value: screeningCompleted, icon: CheckCircle2 },
    { label: 'Hired', value: hiredCandidates, icon: Award },
    { label: 'Average Position Fit', value: `${averageMatch}%`, icon: Target },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#1c1c1a] text-xl font-semibold">{view === 'overview' ? 'Pipeline Overview' : 'Candidates'}</h2>
          <p className="text-sm text-[#6b7063] mt-0.5">
            {view === 'overview'
              ? selectedJob ? `${selectedJob.title} dashboard` : 'All-position analytics and position health'
              : selectedJob ? `${selectedJob.title} candidate worklist` : 'Filter, review, and manage candidate decisions'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-[#2d6a55] font-semibold bg-[#e8f2ee] px-3.5 py-1.5 rounded-full border border-[#2d6a55]/10">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Syncing database...
            </div>
          )}
          <button
            onClick={() => onRefresh()}
            className="inline-flex items-center justify-center w-9 h-9 bg-white border border-[#e4e1da] rounded-lg text-[#6b7063] hover:text-[#1c1c1a] hover:bg-[#f7f6f3] transition-colors"
            title="Refresh candidates"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl p-4 text-sm">
          {actionError}
        </div>
      )}

      {view === 'overview' && (
      <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
              <Briefcase className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
            </div>
            <div>
              <h3 className="text-[#1c1c1a] font-semibold text-base">Position Dashboards</h3>
              <p className="text-xs text-[#6b7063]">Select a role to scope the graph, results, and resume review list.</p>
            </div>
          </div>
          <select
            value={selectedPositionId}
            onChange={(event) => setSelectedPositionId(event.target.value === 'all' ? 'all' : Number(event.target.value))}
            className="min-w-56 px-3 py-2 bg-white border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20"
          >
            <option value="all">All positions</option>
            {jobs.map(job => (
              <option key={job.id} value={job.id}>{job.title}</option>
            ))}
          </select>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {positionStats.map(({ job, pool, completed, hired, average }) => {
            const isSelected = selectedPositionId === job.id;
            return (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedPositionId(job.id)}
                className={`text-left border rounded-xl p-4 transition-colors ${
                  isSelected ? 'border-[#2d6a55]/50 bg-[#f0f9f4]' : 'border-[#e4e1da] hover:border-[#2d6a55]/30 hover:bg-[#f7f6f3]'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm text-[#1c1c1a] font-semibold">{job.title}</p>
                    <p className="text-xs text-[#6b7063] mt-0.5">{job.department}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    job.isOpenForApplications ? 'bg-[#e8f2ee] text-[#2d6a55]' : 'bg-[#f0ede8] text-[#a8a49d]'
                  }`}>
                    {job.isOpenForApplications ? 'Open' : 'Closed'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="text-lg text-[#1c1c1a] font-semibold">{pool.length}</p>
                    <p className="text-xs text-[#a8a49d]">Candidates</p>
                  </div>
                  <div>
                    <p className="text-lg text-[#2d6a55] font-semibold">{completed}</p>
                    <p className="text-xs text-[#a8a49d]">Completed</p>
                  </div>
                  <div>
                    <p className="text-lg text-[#245747] font-semibold">{hired}</p>
                    <p className="text-xs text-[#a8a49d]">Hired</p>
                  </div>
                  <div>
                    <p className="text-lg text-[#c9a84c] font-semibold">{average}%</p>
                    <p className="text-xs text-[#a8a49d]">Avg fit</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedPositionId !== 'all' && (
          <button
            type="button"
            onClick={() => setSelectedPositionId('all')}
            className="mt-4 text-xs text-[#2d6a55] font-semibold hover:underline"
          >
            View all-position dashboard
          </button>
        )}
      </motion.div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {kpiCards.map(({ label, value, icon: Icon }, idx) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: idx * 0.08 }}
            className="bg-white border border-[#e4e1da] rounded-2xl p-6 hover:border-[#2d6a55]/30 transition-colors shadow-sm"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <Icon className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
              </div>
            </div>
            <p className="text-3xl text-[#1c1c1a] mb-1 font-semibold">{value}</p>
            <p className="text-sm text-[#6b7063]">{label}</p>
          </motion.div>
        ))}
      </div>
      </>
      )}

      {/* Bias Mitigation Controls */}
      {view === 'candidates' && (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
          </div>
          <div>
            <h3 className="text-[#1c1c1a] font-semibold text-base">Bias Mitigation Controls</h3>
            <p className="text-xs text-[#6b7063]">Advanced fairness protocols</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-4 bg-[#f7f6f3] rounded-xl border border-[#e4e1da] hover:border-[#2d6a55]/30 transition-colors">
            <div className="flex-1 mr-6">
              <div className="flex items-center gap-2 mb-0.5">
                <label htmlFor="prestige-toggle" className="text-sm text-[#1c1c1a] cursor-pointer font-medium">
                  Prestige Neutralizer Mode
                </label>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                  neutralize ? 'bg-[#e8f2ee] text-[#2d6a55]' : 'bg-[#f0ede8] text-[#a8a49d]'
                }`}>
                  {neutralize ? 'Active' : 'Off'}
                </span>
              </div>
              <p className="text-xs text-[#6b7063]">
                Replace company and university names with descriptive categories dynamically via FastAPI Agent
              </p>
            </div>
            <Switch.Root
              id="prestige-toggle"
              checked={neutralize}
              onCheckedChange={onToggleNeutralize}
              className="w-11 h-6 bg-[#e4e1da] rounded-full relative data-[state=checked]:bg-[#2d6a55] transition-colors outline-none cursor-pointer flex-shrink-0"
            >
              <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
            </Switch.Root>
          </div>

          <div className="flex items-center justify-between p-4 bg-[#f7f6f3] rounded-xl border border-[#e4e1da] hover:border-[#2d6a55]/30 transition-colors">
            <div className="flex-1 mr-6">
              <div className="flex items-center gap-2 mb-0.5">
                <label htmlFor="anonymous-toggle" className="text-sm text-[#1c1c1a] cursor-pointer font-medium">
                  Anonymized Blind Hiring Protocol
                </label>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                  anonymizedMode ? 'bg-[#e8f2ee] text-[#2d6a55]' : 'bg-[#f0ede8] text-[#a8a49d]'
                }`}>
                  {anonymizedMode ? 'Active' : 'Off'}
                </span>
              </div>
              <p className="text-xs text-[#6b7063]">
                Replace candidate names and emails with anonymized ID tokens
              </p>
            </div>
            <Switch.Root
              id="anonymous-toggle"
              checked={anonymizedMode}
              onCheckedChange={setAnonymizedMode}
              className="w-11 h-6 bg-[#e4e1da] rounded-full relative data-[state=checked]:bg-[#2d6a55] transition-colors outline-none cursor-pointer flex-shrink-0"
            >
              <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
            </Switch.Root>
          </div>
        </div>
      </motion.div>
      )}

      {/* Scatter Plot */}
      {view === 'overview' && (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
            <Target className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
          </div>
          <div>
            <h3 className="text-[#1c1c1a] font-semibold text-base">Trajectory Analysis</h3>
            <p className="text-xs text-[#6b7063]">Current-position fit vs. learning velocity</p>
          </div>
        </div>

        {scopedCandidates.length > 0 ? (
          <>
            <div className="bg-[#f7f6f3] rounded-xl p-4 shadow-inner">
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e1da" />
                  <XAxis
                    type="number"
                    dataKey="matchScore"
                    name="Position Fit"
                    unit="%"
                    domain={[0, 100]}
                    label={{ value: 'Position Fit (%)', position: 'insideBottom', offset: -12, style: { fill: '#6b7063', fontSize: 12, fontWeight: 500 } }}
                    stroke="#e4e1da"
                    tick={{ fill: '#a8a49d', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="trajectoryScore"
                    name="Trajectory Slope"
                    unit="%"
                    domain={[0, 100]}
                    label={{ value: 'Trajectory (Learning Rate)', angle: -90, position: 'insideLeft', style: { fill: '#6b7063', fontSize: 12, fontWeight: 500 } }}
                    stroke="#e4e1da"
                    tick={{ fill: '#a8a49d', fontSize: 11 }}
                  />
                  <ZAxis range={[80, 300]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Scatter
                    name="Candidates"
                    data={scatterData}
                    fill="#2d6a55"
                    fillOpacity={0.75}
                    cursor="pointer"
                    onClick={(point: any) => {
                      if (point?.candidate) setSelectedTrajectoryCandidate(point.candidate);
                    }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#2d6a55]" />
                  <p className="text-xs text-[#2d6a55] uppercase tracking-wider font-semibold">High Position Fit + High Trajectory</p>
                </div>
                <p className="text-xs text-[#3d5a4a] leading-relaxed">
                  Ideal candidates with strong fit and exceptional growth potential
                </p>
              </div>
              <div className="bg-[#fdf8ee] border border-[#e8d8a0] rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#c9a84c]" />
                  <p className="text-xs text-[#c9a84c] uppercase tracking-wider font-semibold">Hidden Gems</p>
                </div>
                <p className="text-xs text-[#5a4d2a] leading-relaxed">
                  Fast learners with high potential worth considering despite gaps
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="h-52 flex flex-col items-center justify-center text-[#a8a49d]">
            <Target className="w-10 h-10 mb-3 opacity-30 animate-pulse" />
            <p className="text-sm">No candidate data available</p>
            {selectedJob && <p className="text-xs mt-1">No candidates have applied to {selectedJob.title} yet.</p>}
          </div>
        )}
      </motion.div>
      )}

      {/* Active Pipeline */}
      {(view === 'overview' || view === 'candidates') && (
      <>
      <motion.div
initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 mb-6 border-b border-[#e4e1da] pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <Users className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold text-base">Candidate Pipelines</h3>
                <p className="text-xs text-[#6b7063]">
                  {totalFiltered} {totalFiltered === 1 ? 'candidate' : 'candidates'} filtered
                  {selectedJob ? ` for ${selectedJob.title}` : ''}
                </p>
              </div>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#6b7063] font-medium whitespace-nowrap">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="px-3 py-1.5 bg-white border border-[#e4e1da] rounded-lg text-xs text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              >
                <option value="match">Highest Position Fit</option>
                <option value="match-asc">Lowest Position Fit</option>
                <option value="velocity">Highest Velocity</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-2">
            {[
              { label: 'Active', value: activePipelineCount, tone: 'bg-[#eef2ff] text-[#3730a3] border-[#c7d2fe]' },
              { label: 'Hired', value: hiredCandidates, tone: 'bg-[#e8f2ee] text-[#245747] border-[#c8e6d8]' },
              { label: 'Rejected', value: scopedCandidates.filter(c => c.status === 'rejected').length, tone: 'bg-[#fdf2f2] text-[#b91c1c] border-[#f5c2c2]' }
            ].map(item => (
              <div key={item.label} className={`rounded-xl border px-4 py-3 ${item.tone}`}>
                <p className="text-xs uppercase tracking-wider font-semibold">{item.label}</p>
                <p className="text-xl font-semibold mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-[#6b7063] font-medium mr-1.5">Status:</span>
            {[
              { id: 'all', label: 'All' },
              { id: 'staged', label: 'Staged' },
              { id: 'invited', label: 'Invited' },
              { id: 'applied', label: 'Applied' },
              { id: 'screening', label: 'Screening' },
              { id: 'completed', label: 'Completed' },
              { id: 'hired', label: 'Hired' },
              { id: 'interview_scheduled', label: 'Interview Scheduled' },
              { id: 'rejected', label: 'Rejected' }
            ].map(pill => {
              const count = pill.id === 'all'
                ? scopedCandidates.length
                : scopedCandidates.filter(c => c.status === pill.id).length;
              const isActive = filterStatus === pill.id;
              return (
                <button
                  key={pill.id}
                  onClick={() => {
                    setFilterStatus(pill.id);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#2d6a55] text-white shadow-sm'
                      : 'bg-[#f0ede8] text-[#6b7063] hover:text-[#1c1c1a]'
                  }`}
                >
                  {pill.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Dynamic Success Alert Banner */}
          {inviteSuccessMessage && (
            <div className="mt-3 flex items-center justify-between p-3.5 bg-[#e8f2ee] border border-[#2d6a55]/20 rounded-xl text-xs text-[#2d6a55] font-semibold animate-fadeIn">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2d6a55]" />
                <span>{inviteSuccessMessage}</span>
              </div>
              <button onClick={() => setInviteSuccessMessage('')} className="text-[#2d6a55] hover:text-[#245747] font-bold text-sm leading-none">×</button>
            </div>
          )}

          {/* F4: Undo status change Toast alert banner */}
          {lastActionCandidate && (
            <div className="mt-3 flex items-center justify-between p-3.5 bg-[#fff8ed] border border-[#f2d3a4] rounded-xl text-xs text-[#8a5a14] font-semibold animate-fadeIn shadow-sm">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[#8a5a14] animate-spin" style={{ animationDuration: '3s' }} />
                <span>
                  Changed <strong className="text-[#1c1c1a]">{lastActionCandidate.name}</strong>'s status from{' '}
                  <span className="italic font-bold">"{lastActionCandidate.oldStatus}"</span> to{' '}
                  <span className="italic font-bold">"{lastActionCandidate.newStatus}"</span>.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const c = lastActionCandidate;
                    setLastActionCandidate(null);
                    runAction(c.email, () => onRevertStatus?.(c.email, c.jobId));
                  }}
                  disabled={busyEmail === lastActionCandidate.email}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Undo Last Action
                </button>
                <button
                  onClick={() => setLastActionCandidate(null)}
                  className="text-[#8a5a14] hover:text-[#5a3b0d] font-bold text-sm leading-none cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>

        {totalFiltered === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 bg-[#f0ede8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-[#c8c4bc]" />
            </div>
            <p className="text-sm text-[#1c1c1a] mb-1 font-semibold">No candidates match this filter</p>
            <p className="text-xs text-[#6b7063]">Try adjusting your search criteria or choosing a different status pill</p>
          </div>
        ) : (
          <Accordion.Root type="single" collapsible className="space-y-2.5">
            {paginatedCandidates.map((candidate, index) => {
              const job = jobs.find(j => j.id === candidate.jobId);
              const displayName = getDisplayName(candidate);
              const displayEmail = getDisplayEmail(candidate);
              const actionEmail = getActionEmail(candidate);

              // Form bindings
              const draftOutreach = editedOutreach[candidate.email] ?? candidate.recruitmentEmail ?? '';
              const draftFeedback = editedFeedback[candidate.email] ?? candidate.hrFeedback ?? '';
              const isSavingThis = isSavingField[candidate.email] ?? false;

              const saveOutreachField = async () => {
                setIsSavingField(prev => ({ ...prev, [candidate.email]: true }));
                try {
                  await onUpdateOutreachNotes(actionEmail, candidate.jobId, draftOutreach, undefined);
                  setInviteSuccessMessage(`Outreach email saved successfully for ${candidate.name}!`);
                  setTimeout(() => setInviteSuccessMessage(''), 4000);
                } catch (err: any) {
                  setActionError(err.message || 'Failed to update outreach notes.');
                } finally {
                  setIsSavingField(prev => ({ ...prev, [candidate.email]: false }));
                }
              };

              const saveFeedbackField = async () => {
                setIsSavingField(prev => ({ ...prev, [candidate.email]: true }));
                try {
                  await onUpdateOutreachNotes(actionEmail, candidate.jobId, undefined, draftFeedback);
                  setInviteSuccessMessage(`Internal notes saved successfully for ${candidate.name}!`);
                  setTimeout(() => setInviteSuccessMessage(''), 4000);
                } catch (err: any) {
                  setActionError(err.message || 'Failed to update HR notes.');
                } finally {
                  setIsSavingField(prev => ({ ...prev, [candidate.email]: false }));
                }
              };

              return (
                <motion.div
                  key={`${candidate.email}-${candidate.applicationId || candidate.jobId || index}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                >
                  <Accordion.Item
                    value={`candidate-${candidate.id}-${candidate.applicationId || candidate.jobId || index}`}
                    className="border border-[#e4e1da] rounded-xl overflow-hidden hover:border-[#2d6a55]/30 transition-colors bg-white shadow-sm"
                  >
                    <Accordion.Header>
                      <Accordion.Trigger className="w-full px-5 py-4 bg-[#f7f6f3] hover:bg-[#f0ede8] transition-colors text-left group cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 flex-1">
                            <div className="relative flex-shrink-0">
                              {candidate.profilePictureUrl ? (
                                <img
                                  src={`${API_ORIGIN}${candidate.profilePictureUrl}`}
                                  alt={displayName}
                                  className="w-12 h-12 rounded-xl object-cover border border-[#e4e1da]"
                                />
                              ) : (
                                <div className="w-12 h-12 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] font-semibold text-lg">
                                  {displayName.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm border border-[#e4e1da]">
                                {candidate.status === 'invited' && <CheckCircle2 className="w-2.5 h-2.5 text-[#2d6a55]" />}
                                {candidate.status === 'completed' && <Award className="w-2.5 h-2.5 text-[#c9a84c]" />}
                                {candidate.status === 'hired' && <CheckCircle2 className="w-2.5 h-2.5 text-[#245747]" />}
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="text-sm text-[#1c1c1a] font-semibold">{displayName}</h4>
                                
                                {/* High position fit badge */}
                                {candidate.matchScore >= 80 && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#e8f2ee] text-[#2d6a55] whitespace-nowrap flex items-center gap-1">
                                    ★ High Fit
                                  </span>
                                )}
                                {(() => {
                                  const phase = getCandidatePhase(candidate.status, candidate.answers);
                                  const classes = 
                                    phase === 'Waiting for Screening' ? 'bg-[#f0ede8] text-[#6b7063]' :
                                    phase === 'Screening Completed' ? 'bg-[#fff7ed] text-[#c2410c]' :
                                    phase === 'Waiting for Interview' ? 'bg-[#fef9c3] text-[#854d0e]' :
                                    phase === 'Interview In Progress' ? 'bg-[#e0e7ff] text-[#3730a3]' :
                                    phase === 'Hired' ? 'bg-[#dcfce7] text-[#15803d]' :
                                    'bg-[#fee2e2] text-[#b91c1c]'; // Rejected
                                  return (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>
                                      {phase}
                                    </span>
                                  );
                                })()}                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white border border-[#e4e1da] text-[#6b7063] whitespace-nowrap">
                                  {candidate.sourceMethod === 'prototype_auto_source' ? 'LinkedIn auto search' : candidate.sourceMethod === 'manual_authenticated' ? 'LinkedIn authenticated' : candidate.sourceType === 'linkedin' ? 'LinkedIn manual add' : 'Inbound resume'}
                                </span>
                              </div>
                              <p className="text-xs text-[#6b7063] truncate">{neutralizeText(candidate.headline)}</p>
                              <p className="text-xs text-[#a8a49d] mt-0.5">{job?.title || 'Sourced Position'}</p>
                            </div>

                            <div className="flex items-center gap-5 mr-4">
                              <div className="text-center">
                                <div className={`text-lg font-semibold ${
                                  candidate.matchScore >= 80 ? 'text-[#2d6a55]' :
                                  candidate.matchScore >= 60 ? 'text-[#c9a84c]' :
                                  'text-[#6b7063]'
                                }`}>{candidate.matchScore}</div>
                                <div className="text-xs text-[#a8a49d]">Position Fit</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg text-[#c9a84c] font-semibold">{candidate.trajectoryScore}</div>
                                <div className="text-xs text-[#a8a49d]">Velocity</div>
                              </div>
                            </div>
                          </div>
                          <ChevronDown className="w-4 h-4 text-[#a8a49d] transition-transform duration-200 group-data-[state=open]:rotate-180 flex-shrink-0" />
                        </div>
                      </Accordion.Trigger>
                    </Accordion.Header>

                    <Accordion.Content className="px-5 py-5 border-t border-[#e4e1da] bg-white overflow-hidden">
                      <div className="space-y-5">
                        {/* Executive Summary */}
                        {candidate.sourcingPitch && (
                          <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                            <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Why This Person?</p>
                            <p className="text-sm text-[#6b7063] leading-relaxed italic">
                              "{neutralizeText(candidate.sourcingPitch)}"
                            </p>
                          </div>
                        )}

                        {candidate.positionFitSummary && (
                          <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4 shadow-sm">
                            <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-2 font-semibold">Current Position Fit Reasoning</p>
                            <p className="text-sm text-[#3d5a4a] leading-relaxed">
                              {neutralizeText(candidate.positionFitSummary)}
                            </p>
                            {candidate.fitBreakdown?.must_have && (
                              <div className="grid md:grid-cols-3 gap-3 mt-3 text-xs">
                                <div>
                                  <p className="text-[#2d6a55] font-semibold mb-1">Matched</p>
                                  <p className="text-[#6b7063] leading-relaxed">{candidate.fitBreakdown.must_have.matched?.join(', ') || 'None yet'}</p>
                                </div>
                                <div>
                                  <p className="text-[#8a5a14] font-semibold mb-1">Partial</p>
                                  <p className="text-[#6b7063] leading-relaxed">{candidate.fitBreakdown.must_have.partial?.join(', ') || 'None'}</p>
                                </div>
                                <div>
                                  <p className="text-[#b91c1c] font-semibold mb-1">Verify</p>
                                  <p className="text-[#6b7063] leading-relaxed">{candidate.fitBreakdown.must_have.missing?.join(', ') || 'No major gaps'}</p>
                                </div>
                              </div>
                            )}
                            {(candidate.scoreExplanation || candidate.scoreContributors?.length) && (
                              <div className="mt-4 pt-4 border-t border-[#c8e6d8]">
                                <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-2 font-semibold">Match Score Calculation</p>
                                {candidate.scoreExplanation && (
                                  <p className="text-xs text-[#3d5a4a] leading-relaxed mb-3">
                                    {neutralizeText(candidate.scoreExplanation)}
                                  </p>
                                )}
                                {candidate.scoreContributors?.length ? (
                                  <div className="grid md:grid-cols-2 gap-2">
                                    {candidate.scoreContributors.map((item, contributorIndex) => (
                                      <div key={`${item.factor}-${contributorIndex}`} className="bg-white border border-[#c8e6d8] rounded-lg p-3">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                          <p className="text-xs text-[#1c1c1a] font-semibold">{item.factor}</p>
                                          <span className="text-xs text-[#2d6a55] font-semibold">{item.score}/100</span>
                                        </div>
                                        <p className="text-[11px] text-[#6b7063] leading-relaxed">
                                          Weight {item.weight}% · contributes {item.impact} points. {neutralizeText(item.reason || '')}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        )}

                        {candidate.sourceWarning && (
                          <div className="bg-[#fff8ed] border border-[#f2d3a4] rounded-xl p-4 shadow-sm">
                            <p className="text-xs tracking-wider uppercase text-[#8a5a14] mb-2 font-semibold">LinkedIn Source Verification</p>
                            <div className="flex flex-wrap gap-2 mb-2">
                              <span className="px-2 py-0.5 rounded-full bg-white border border-[#f2d3a4] text-xs font-semibold text-[#8a5a14]">
                                {candidate.sourceMethod === 'prototype_auto_source' ? 'LinkedIn auto search' : candidate.sourceMethod === 'manual_authenticated' ? 'LinkedIn authenticated' : candidate.sourceType === 'linkedin' ? 'LinkedIn manual add' : 'Inbound resume'}
                              </span>
                            </div>
                            <p className="text-sm text-[#6b7063] leading-relaxed">{candidate.sourceWarning}</p>
                            {candidate.sourceStatus && (
                              <p className="text-xs text-[#a8a49d] mt-2">Extraction status: {candidate.sourceStatus}</p>
                            )}
                          </div>
                        )}

                        {/* Actions Control Panel */}
                        <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <p className="text-xs tracking-wider uppercase text-[#a8a49d] font-semibold">Manage Candidate Status</p>
                            {busyEmail === actionEmail && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-[#2d6a55] font-semibold">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Updating...
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {candidate.status === 'staged' && (
                              <button
                                onClick={async () => {
                                  const result: any = await runAction(actionEmail, () => onInvite(actionEmail, draftOutreach, draftFeedback));
                                  if (!result) return;
                                  const message = result?.outreach_sent
                                    ? `Invitation email sent to ${candidate.name}.`
                                    : result?.smtp_configured === false
                                      ? `Invitation saved for ${candidate.name}. SMTP is not configured, so no email was sent.`
                                      : `Invitation saved for ${candidate.name}. Email delivery was not confirmed.`;
                                  setInviteSuccessMessage(message);
                                  toast.success(message);
                                  setTimeout(() => setInviteSuccessMessage(''), 4500);
                                }}
                                disabled={busyEmail === actionEmail}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                Send Invite & Outreach
                              </button>
                            )}

                            {/* Manual screening workflow buttons for screening candidates (F5) */}
                            {candidate.status === 'screening' ? (
                              <div className="flex flex-wrap gap-2 w-full p-3 bg-[#fdf0e6]/40 border border-[#c25a2a]/20 rounded-xl mb-1">
                                <div className="w-full text-xs font-semibold text-[#c25a2a] mb-1.5">Manual Screening Decisions:</div>
                                <button
                                  onClick={() => runAction(actionEmail, () => onStatusChange(actionEmail, 'completed', candidate.jobId))}
                                  disabled={busyEmail === actionEmail}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Pass Screening / Mark Complete
                                </button>
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Complete hiring for ${candidate.name}? This will move the candidate into the Hired category.`)) {
                                      runAction(actionEmail, () => onStatusChange(actionEmail, 'hired', candidate.jobId));
                                    }
                                  }}
                                  disabled={busyEmail === actionEmail}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#245747] text-white rounded-lg hover:bg-[#1f4a3d] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                >
                                  <Award className="w-3.5 h-3.5" />
                                  Complete Hire
                                </button>
                                <button
                                  onClick={() => {
                                    setScheduleTarget(candidate);
                                    setScheduleDate(candidate.interviewSlot?.date || '');
                                    setScheduleTime(candidate.interviewSlot?.time || '');
                                    setScheduleLocation(candidate.interviewSlot?.location || 'To be confirmed');
                                    setScheduleNotes(candidate.interviewSlot?.notes || '');
                                  }}
                                  disabled={busyEmail === actionEmail}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#eef2ff] border border-[#c7d2fe] text-[#3730a3] rounded-lg hover:bg-[#e0e7ff] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                  Schedule Interview
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectTarget(candidate);
                                    setRejectFeedback('');
                                    setRejectMessage('Thank you for applying. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs. We appreciate the time you invested and wish you success in your career journey.');
                                  }}
                                  disabled={busyEmail === actionEmail}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#f0c9c9] text-[#b91c1c] rounded-lg hover:bg-[#fdf2f2] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  Reject Candidate
                                </button>
                              </div>
                            ) : (
                              <>
                                {/* F3: Combined Mark Screening / Mark Complete split-button */}
                                {candidate.status !== 'completed' && candidate.status !== 'hired' && candidate.status !== 'rejected' && candidate.status !== 'interview_scheduled' && (
                                  <div className="relative inline-flex rounded-lg shadow-sm" style={{ isolation: 'isolate' }}>
                                    {/* Primary: Mark Screening */}
                                    <button
                                      onClick={() => runAction(actionEmail, () => onStatusChange(actionEmail, 'screening', candidate.jobId))}
                                      disabled={busyEmail === actionEmail}
                                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-l-lg hover:bg-[#f7f6f3] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer border-r-0"
                                    >
                                      <UserCheck className="w-3.5 h-3.5" />
                                      Mark Screening
                                    </button>
                                    {/* Dropdown toggle */}
                                    <button
                                      onClick={() => setOpenMarkDropdown(prev => prev === actionEmail ? '' : actionEmail)}
                                      disabled={busyEmail === actionEmail}
                                      className="inline-flex items-center justify-center px-2 py-2 bg-white border border-[#e4e1da] text-[#6b7063] rounded-r-lg hover:bg-[#f7f6f3] hover:text-[#1c1c1a] disabled:opacity-50 text-xs transition-colors cursor-pointer"
                                      title="More options"
                                    >
                                      <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${openMarkDropdown === actionEmail ? 'rotate-180' : ''}`} />
                                    </button>
                                    {/* Dropdown: Mark Complete */}
                                    {openMarkDropdown === actionEmail && (
                                      <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-[#e4e1da] rounded-xl shadow-lg overflow-hidden min-w-[160px]">
                                        <button
                                          onClick={() => {
                                            setOpenMarkDropdown('');
                                            runAction(actionEmail, () => onStatusChange(actionEmail, 'completed', candidate.jobId));
                                          }}
                                          disabled={busyEmail === actionEmail}
                                          className="w-full inline-flex items-center gap-2 px-4 py-2.5 hover:bg-[#f0f9f4] text-xs font-medium text-[#2d6a55] transition-colors cursor-pointer"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          Mark Complete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {candidate.status !== 'hired' && candidate.status !== 'rejected' && candidate.status !== 'interview_scheduled' && (
                                  <button
                                    onClick={() => {
                                      setScheduleTarget(candidate);
                                      setScheduleDate(candidate.interviewSlot?.date || '');
                                      setScheduleTime(candidate.interviewSlot?.time || '');
                                      setScheduleLocation(candidate.interviewSlot?.location || 'To be confirmed');
                                      setScheduleNotes(candidate.interviewSlot?.notes || '');
                                    }}
                                    disabled={busyEmail === actionEmail}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-[#eef2ff] border border-[#c7d2fe] text-[#3730a3] rounded-lg hover:bg-[#e0e7ff] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    <Calendar className="w-3.5 h-3.5" />
                                    Schedule Interview
                                  </button>
                                )}
                                {candidate.status !== 'hired' && candidate.status !== 'rejected' && (
                                  <button
                                    onClick={() => {
                                      setRejectTarget(candidate);
                                      setRejectFeedback('');
                                      setRejectMessage('Thank you for applying. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs. We appreciate the time you invested and wish you success in your career journey.');
                                    }}
                                    disabled={busyEmail === actionEmail}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#f0c9c9] text-[#b91c1c] rounded-lg hover:bg-[#fdf2f2] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    Reject
                                  </button>
                                )}
                                {candidate.status !== 'hired' && candidate.status !== 'rejected' && (
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Complete hiring for ${candidate.name}? This will finalize recruitment for this candidate.`)) {
                                        runAction(actionEmail, () => onStatusChange(actionEmail, 'hired', candidate.jobId));
                                      }
                                    }}
                                    disabled={busyEmail === actionEmail}
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-[#245747] text-white rounded-lg hover:bg-[#1f4a3d] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                  >
                                    <Award className="w-3.5 h-3.5" />
                                    Complete Hire
                                  </button>
                                )}
                              </>
                            )}


                            <button
                              onClick={() => {
                                if (window.confirm(`Delete ${candidate.name} from the pipeline?`)) {
                                  runAction(actionEmail, () => onDelete(actionEmail));
                                }
                              }}
                              disabled={busyEmail === actionEmail}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#f0c9c9] text-[#b91c1c] rounded-lg hover:bg-[#fdf2f2] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>

                            {/* F4: Undo Last Status */}
                            {onRevertStatus && candidate.statusHistory && candidate.statusHistory.length > 0 && (
                              <button
                                onClick={() => {
                                  if (window.confirm(`Undo the last status change for ${candidate.name}? This will revert them from "${candidate.status}" back to "${candidate.statusHistory![candidate.statusHistory!.length - 1]}".`)) {
                                    runAction(actionEmail, () => onRevertStatus(actionEmail, candidate.jobId));
                                  }
                                }}
                                disabled={busyEmail === actionEmail}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#e4e1da] text-[#6b7063] rounded-lg hover:bg-[#f7f6f3] hover:text-[#1c1c1a] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                                title={`Undo: revert to "${candidate.statusHistory[candidate.statusHistory.length - 1]}"`}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Undo Last Status
                              </button>
                            )}
                          </div>
                        </div>

                        {/* F1: Outreach Email Editable Area & F2: Standalone Internal Notes / Feedback */}
                        <div className="grid md:grid-cols-2 gap-4">
                          {/* F6: Editable Outreach email text area */}
                          <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs tracking-wider uppercase text-[#a8a49d] font-semibold">Outreach Recruitment Pitch</span>
                              <span className="text-[10px] text-[#2d6a55] font-semibold">Draft</span>
                            </div>
                            {/* F6: Template chips */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-[#a8a49d] font-semibold uppercase tracking-wider mr-1 flex-shrink-0">Templates:</span>
                              {OUTREACH_TEMPLATES.map((template) => (
                                <button
                                  key={template.label}
                                  type="button"
                                  onClick={() => setEditedOutreach(prev => ({
                                    ...prev,
                                    [candidate.email]: template.generate(
                                      candidate.name || 'there',
                                      job?.title || 'this position'
                                    )
                                  }))}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#e4e1da] bg-[#f7f6f3] text-[10px] font-semibold text-[#6b7063] hover:bg-[#e8f2ee] hover:border-[#2d6a55] hover:text-[#2d6a55] transition-colors cursor-pointer"
                                >
                                  <span>{template.emoji}</span>
                                  {template.label}
                                </button>
                              ))}
                            </div>
                            <textarea
                              value={draftOutreach}
                              onChange={(e) => setEditedOutreach(prev => ({ ...prev, [candidate.email]: e.target.value }))}
                              placeholder="Personalized outreach pitch sent or to be sent to candidate..."
                              rows={5}
                              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-xs text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                            />

                            <div className="text-right">
                              <button
                                onClick={saveOutreachField}
                                disabled={isSavingThis}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {isSavingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Save Outreach
                              </button>
                            </div>
                            {candidate.outreachHistory?.length ? (
                              <div className="border-t border-[#e4e1da] pt-3 space-y-2">
                                <p className="text-[10px] text-[#a8a49d] uppercase tracking-wider font-semibold">Message History</p>
                                {candidate.outreachHistory.slice(0, 3).map(item => (
                                  <div key={item.id} className="rounded-lg bg-[#f7f6f3] border border-[#e4e1da] p-2">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className={`text-[10px] font-semibold uppercase ${item.status === 'sent' ? 'text-[#2d6a55]' : item.status === 'failed' ? 'text-[#b91c1c]' : 'text-[#8a5a14]'}`}>{item.status}</span>
                                      <span className="text-[10px] text-[#a8a49d]">{new Date(item.sent_at).toLocaleString()}</span>
                                    </div>
                                    <p className="text-[11px] text-[#6b7063] whitespace-pre-wrap line-clamp-3">{item.message}</p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {/* F2: Standalone Internal notes / HR feedback */}
                          <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs tracking-wider uppercase text-[#a8a49d] font-semibold">Internal HR Notes & Feedback</span>
                              <span className="text-[10px] text-[#3730a3] font-semibold">Hiring Team Notes</span>
                            </div>
                            <textarea
                              value={draftFeedback}
                              onChange={(e) => setEditedFeedback(prev => ({ ...prev, [candidate.email]: e.target.value }))}
                              placeholder="Add internal candidate performance notes, feedback, or interview impressions..."
                              rows={5}
                              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-xs text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                            />
                            <div className="text-right">
                              <button
                                onClick={saveFeedbackField}
                                disabled={isSavingThis}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3730a3] text-white rounded-lg hover:bg-[#312e81] text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {isSavingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Save Notes & Feedback
                              </button>
                            </div>
                            {candidate.hrFeedback ? (
                              <div className="border-t border-[#e4e1da] pt-3 space-y-2">
                                <p className="text-[10px] text-[#a8a49d] uppercase tracking-wider font-semibold">Active Saved Notes</p>
                                <div className="rounded-lg bg-[#f5f3ff] border border-[#e0dbff] p-3 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#3730a3]">Saved Feedback Note</span>
                                    <button
                                      type="button"
                                      onClick={() => setEditedFeedback(prev => ({ ...prev, [candidate.email]: candidate.hrFeedback || '' }))}
                                      className="text-[10px] font-semibold text-[#3730a3] hover:underline cursor-pointer bg-transparent border-none p-0"
                                    >
                                      Edit Note
                                    </button>
                                  </div>
                                  <p className="text-xs text-[#1e1b4b] whitespace-pre-wrap leading-relaxed">{candidate.hrFeedback}</p>
                                </div>
                              </div>
                            ) : null}
                          </div>                        </div>

                        {/* Profile */}
                        <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                          <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-3 font-semibold">Profile</p>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-xs text-[#a8a49d]">Email</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{displayEmail}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Location</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.location || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Age</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.age || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Phone</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.phone || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Address</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.address || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Came From</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.cameFrom || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Qualification</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.qualification || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Grade and Results</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.gradeResults || 'Not extracted'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-[#a8a49d]">Resume File</span>
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.resumeFilename || 'No PDF stored'}</p>
                            </div>
                          </div>
                          {candidate.awards?.length ? (
                            <div className="mt-3 pt-3 border-t border-[#e4e1da]">
                              <span className="text-xs text-[#a8a49d]">Awards</span>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {candidate.awards.map((award, idx) => (
                                  <span key={`${award}-${idx}`} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">
                                    {award}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {candidate.workExperience && (
                            <div className="mt-3 pt-3 border-t border-[#e4e1da]">
                              <span className="text-xs text-[#a8a49d]">Work Experience</span>
                              <p className="text-sm text-[#6b7063] mt-1 leading-relaxed">{candidate.workExperience}</p>
                            </div>
                          )}
                          {candidate.skills?.length ? (
                            <div className="mt-3 pt-3 border-t border-[#e4e1da]">
                              <span className="text-xs text-[#a8a49d]">Resume Agent Skills</span>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {candidate.skills.slice(0, 10).map((skill, idx) => (
                                  <span key={`${skill}-${idx}`} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {candidate.about && (
                            <div className="mt-3 pt-3 border-t border-[#e4e1da]">
                              <p className="text-sm text-[#6b7063] leading-relaxed">{neutralizeText(candidate.about)}</p>
                            </div>
                          )}
                          {candidate.resumeSummary && (
                            <div className="mt-3 pt-3 border-t border-[#e4e1da]">
                              <span className="text-xs text-[#a8a49d]">Resume Summary</span>
                              <p className="text-sm text-[#6b7063] mt-1 leading-relaxed">{neutralizeText(candidate.resumeSummary)}</p>
                            </div>
                          )}
                        </div>

                        {(candidate.resumeUrl || candidate.resumeText) && (
                          <details className="group bg-white border border-[#e4e1da] rounded-xl overflow-hidden shadow-sm">
                            <summary className="cursor-pointer px-4 py-3 hover:bg-[#f7f6f3] transition-colors flex items-center justify-between font-medium text-sm text-[#1c1c1a]">
                              <span className="text-sm text-[#6b7063] group-hover:text-[#1c1c1a] transition-colors">
                                View Resume {candidate.resumeFilename ? `- ${candidate.resumeFilename}` : ''}
                              </span>
                              <ChevronDown className="w-4 h-4 text-[#a8a49d] transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="px-4 pb-4 pt-2 border-t border-[#e4e1da]">
                              {candidate.resumeUrl && (
                                <div className="mb-3">
                                  <PdfResumeViewer url={`${API_ORIGIN}${candidate.resumeUrl}`} filename={candidate.resumeFilename} />
                                </div>
                              )}
                              {candidate.resumeText && (
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[#6b7063] leading-relaxed font-sans">
                                  {candidate.resumeText}
                                </pre>
                              )}
                            </div>
                          </details>
                        )}

                        {/* Experience */}
                        {candidate.experiences?.length > 0 && (
                          <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                            <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-3 font-semibold">Experience</p>
                            <div className="space-y-3">
                              {candidate.experiences.map((exp, idx) => (
                                <div key={idx} className="flex gap-3">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2d6a55] flex-shrink-0" />
                                  <div>
                                    <p className="text-sm text-[#1c1c1a] font-semibold">{exp.title}</p>
                                    <p className="text-xs text-[#6b7063] font-medium">{neutralizeText(exp.company)}</p>
                                    <p className="text-xs text-[#a8a49d]">{exp.duration}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Education */}
                        {candidate.education?.length > 0 && (
                          <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                            <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-3 font-semibold">Education</p>
                            <div className="space-y-2">
                              {candidate.education.map((edu, idx) => (
                                <div key={idx}>
                                  <p className="text-sm text-[#1c1c1a] font-semibold">{neutralizeText(edu.school)}</p>
                                  <p className="text-xs text-[#6b7063]">{edu.degree}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* AI Committee Debate */}
                        <div>
                          <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-3 font-semibold">AI Committee Analysis</p>
                          <div className="grid md:grid-cols-2 gap-3">
                            <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4 shadow-sm">
                              <div className="flex items-center gap-2 mb-3">
                                <TrendingUp className="w-4 h-4 text-[#2d6a55]" />
                                <p className="text-xs text-[#2d6a55] uppercase tracking-wider font-semibold">Talent Advocate</p>
                              </div>
                              {candidate.advocatePros?.length ? (
                                <ul className="space-y-2">
                                  {candidate.advocatePros.map((pro, idx) => (
                                    <li key={idx} className="text-xs text-[#3d5a4a] flex items-start gap-2 leading-relaxed font-medium">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-[#2d6a55] flex-shrink-0 mt-0.5" />
                                      <span>{pro}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : <p className="text-xs text-[#6b7063]">Analysis pending...</p>}
                            </div>

                            <div className="bg-[#fdf8ee] border border-[#e8d8a0] rounded-xl p-4 shadow-sm">
                              <div className="flex items-center gap-2 mb-3">
                                <TrendingDown className="w-4 h-4 text-[#c9a84c]" />
                                <p className="text-xs text-[#c9a84c] uppercase tracking-wider font-semibold">Critical Recruiter</p>
                              </div>
                              {candidate.recruiterCons?.length ? (
                                <ul className="space-y-2">
                                  {candidate.recruiterCons.map((con, idx) => (
                                    <li key={idx} className="text-xs text-[#5a4d2a] flex items-start gap-2 leading-relaxed font-medium">
                                      <AlertCircle className="w-3.5 h-3.5 text-[#c9a84c] flex-shrink-0 mt-0.5" />
                                      <span>{con}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : <p className="text-xs text-[#6b7063]">Analysis pending...</p>}
                            </div>
                          </div>
                        </div>

                        {/* Screening Results */}
                        {(candidate.status === 'completed' || candidate.status === 'screening' || candidate.status === 'hired') && candidate.screeningScore !== undefined && (
                          <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                                  <CheckCircle2 className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
                                </div>
                                <div>
                                  <p className="text-sm text-[#1c1c1a] font-semibold">Position-Focused Screening {candidate.status === 'screening' ? 'In Progress' : 'Complete'}</p>
                                  <p className="text-xs text-[#6b7063]">{candidate.evaluation?.position_fit_verdict || 'Answers evaluated against the selected position requirements'}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl text-[#2d6a55] font-semibold">{candidate.screeningScore}</div>
                                <div className="text-xs text-[#6b7063]">/ 100</div>
                              </div>
                            </div>
                            {candidate.evaluation?.role_alignment_summary && (
                              <p className="text-xs text-[#6b7063] leading-relaxed mt-3 border-t border-[#e4e1da] pt-3">
                                {candidate.evaluation.role_alignment_summary}
                              </p>
                            )}
                            {candidate.evaluation?.score_breakdown && (
                              <div className="grid sm:grid-cols-5 gap-2 mt-3">
                                {[
                                  ['Role', candidate.evaluation.score_breakdown.role_requirement_alignment, 35],
                                  ['Depth', candidate.evaluation.score_breakdown.technical_correctness_depth, 25],
                                  ['Evidence', candidate.evaluation.score_breakdown.evidence_specificity, 20],
                                  ['Impact', candidate.evaluation.score_breakdown.position_impact, 10],
                                  ['Clarity', candidate.evaluation.score_breakdown.communication_clarity, 10]
                                ].map(([label, value, max]) => (
                                  <div key={label} className="bg-white border border-[#e4e1da] rounded-lg p-2">
                                    <p className="text-[10px] text-[#a8a49d] uppercase tracking-wider font-semibold">{label}</p>
                                    <p className="text-sm text-[#1c1c1a] font-semibold mt-0.5">{value || 0}/{max}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {candidate.evaluation?.critiques?.length ? (
                              <div className="mt-4 pt-4 border-t border-[#e4e1da] space-y-3">
                                <p className="text-xs tracking-wider uppercase text-[#a8a49d] font-semibold">Question-Specific AI Feedback</p>
                                {candidate.evaluation.critiques.map((item: any, critiqueIndex: number) => (
                                  <div key={`${candidate.email}-critique-${critiqueIndex}`} className="bg-white border border-[#e4e1da] rounded-lg p-3">
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <p className="text-xs text-[#2d6a55] font-semibold">Question {critiqueIndex + 1}</p>
                                      {item.per_answer_score !== undefined && (
                                        <span className="text-xs text-[#1c1c1a] font-semibold">{item.per_answer_score}/100</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-[#1c1c1a] font-medium leading-relaxed">{item.question}</p>
                                    {(item.candidate_answer || item.candidate_answer_excerpt || candidate.answers?.[critiqueIndex]) && (
                                      <p className="text-xs text-[#6b7063] mt-2 leading-relaxed">
                                        <span className="font-semibold text-[#1c1c1a]">Candidate answer:</span> {item.candidate_answer || candidate.answers?.[critiqueIndex] || item.candidate_answer_excerpt}
                                      </p>
                                    )}
                                    {item.requirement_focus && (
                                      <p className="text-xs text-[#6b7063] mt-1">
                                        <span className="font-semibold text-[#1c1c1a]">Role focus:</span> {item.requirement_focus}
                                      </p>
                                    )}
                                    <p className="text-xs text-[#6b7063] mt-2 leading-relaxed">{alignScoreMentions(item.critique, item.per_answer_score)}</p>
                                    {item.strengths?.length ? (
                                      <div className="mt-3">
                                        <p className="text-[10px] text-[#2d6a55] uppercase tracking-wider font-semibold mb-1.5">Evidence supporting the score</p>
                                        <ul className="space-y-1">
                                          {item.strengths.map((strength: string, strengthIndex: number) => (
                                            <li key={strengthIndex} className="text-xs text-[#3d5a4a] leading-relaxed flex items-start gap-1.5">
                                              <CheckCircle2 className="w-3 h-3 text-[#2d6a55] flex-shrink-0 mt-0.5" />
                                              <span>{strength}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {item.weaknesses?.length ? (
                                      <div className="mt-3">
                                        <p className="text-[10px] text-[#c25a2a] uppercase tracking-wider font-semibold mb-1.5">Risks or missing proof</p>
                                        <ul className="space-y-1">
                                          {item.weaknesses.map((weakness: string, weaknessIndex: number) => (
                                            <li key={weaknessIndex} className="text-xs text-[#6b7063] leading-relaxed flex items-start gap-1.5">
                                              <AlertCircle className="w-3 h-3 text-[#c25a2a] flex-shrink-0 mt-0.5" />
                                              <span>{weakness}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {(item.suggested_improvement || item.hiring_manager_note) && (
                                      <div className="mt-3 rounded-lg border border-[#e4e1da] bg-[#f7f6f3] p-3">
                                        {item.hiring_manager_note && (
                                          <p className="text-xs text-[#1c1c1a] leading-relaxed">
                                            <span className="font-semibold">Hiring manager note:</span> {item.hiring_manager_note}
                                          </p>
                                        )}
                                        {item.suggested_improvement && (
                                          <p className="text-xs text-[#6b7063] leading-relaxed mt-2">
                                            <span className="font-semibold text-[#1c1c1a]">Suggested probe:</span> {item.suggested_improvement}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        )}

                        {/* Hiring Completion Info */}
                        {candidate.status === 'hired' && (
                          <div className="bg-[#e8f2ee] border border-[#c8e6d8] rounded-xl p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <Award className="w-4 h-4 text-[#245747]" />
                              <p className="text-xs text-[#245747] uppercase tracking-wider font-semibold">Candidate Hired</p>
                            </div>
                            <p className="text-xs text-[#3d5a4a] leading-relaxed">
                              Recruitment has been finalized for this candidate and they are now separated from the active and rejected pipelines.
                            </p>
                            {candidate.hiredAt && <p className="text-xs text-[#6b7063] mt-1">Completed at: {new Date(candidate.hiredAt).toLocaleString()}</p>}
                          </div>
                        )}

                        {/* Interview Slot Details */}
                        {candidate.status === 'interview_scheduled' && candidate.interviewSlot && (
                          <div className="bg-[#eef2ff] border border-[#c7d2fe] rounded-xl p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                              <Calendar className="w-4 h-4 text-[#3730a3]" />
                              <p className="text-xs text-[#3730a3] uppercase tracking-wider font-semibold">Interview Scheduled</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div><span className="text-[#6b7280]">Date</span><p className="text-[#1c1c1a] font-medium mt-0.5">{candidate.interviewSlot.date}</p></div>
                              <div><span className="text-[#6b7280]">Time</span><p className="text-[#1c1c1a] font-medium mt-0.5">{candidate.interviewSlot.time}</p></div>
                              <div><span className="text-[#6b7280]">Location</span><p className="text-[#1c1c1a] font-medium mt-0.5">{candidate.interviewSlot.location}</p></div>
                              {candidate.interviewSlot.notes && <div className="col-span-2 mt-1.5"><span className="text-[#6b7280]">Notes</span><p className="text-[#1c1c1a] font-medium mt-0.5 leading-relaxed">{candidate.interviewSlot.notes}</p></div>}
                            </div>
                            <button
                              onClick={() => {
                                setScheduleTarget(candidate);
                                setScheduleDate(candidate.interviewSlot?.date || '');
                                setScheduleTime(candidate.interviewSlot?.time || '');
                                setScheduleLocation(candidate.interviewSlot?.location || 'To be confirmed');
                                setScheduleNotes(candidate.interviewSlot?.notes || '');
                              }}
                              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#c7d2fe] text-[#3730a3] rounded-lg hover:bg-[#e0e7ff] text-xs font-medium transition-colors"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              Edit Interview Time
                            </button>
                          </div>
                        )}

                        {/* Rejection Info */}
                        {candidate.status === 'rejected' && (
                          <div className="bg-[#fdf2f2] border border-[#f5c2c2] rounded-xl p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="w-4 h-4 text-[#b91c1c]" />
                              <p className="text-xs text-[#b91c1c] uppercase tracking-wider font-semibold">Candidate Rejected</p>
                            </div>
                            {candidate.hrFeedback && <p className="text-xs text-[#6b7063] mt-1"><span className="font-semibold text-[#1c1c1a]">HR Notes:</span> {candidate.hrFeedback}</p>}
                            {candidate.rejectionMessage && <p className="text-xs text-[#6b7063] mt-1"><span className="font-semibold text-[#1c1c1a]">Sent apology email:</span> "{candidate.rejectionMessage}"</p>}
                            {candidate.rejectedAt && <p className="text-xs text-[#a8a49d] mt-1">Rejected at: {new Date(candidate.rejectedAt).toLocaleString()}</p>}
                          </div>
                        )}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                </motion.div>
              );
            })}
          </Accordion.Root>
        )}

        {/* Pagination Footer Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#e4e1da] pt-5 mt-5">
            <span className="text-xs text-[#6b7063]">
              Showing {Math.min(totalFiltered, (currentPage - 1) * pageSize + 1)} to {Math.min(totalFiltered, currentPage * pageSize)} of {totalFiltered} candidates
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Previous
              </button>
              {visiblePages.map((page, index) => (
                <span key={page} className="inline-flex items-center gap-1.5">
                  {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-[#a8a49d]">...</span>}
                  <button
                    onClick={() => setCurrentPage(page)}
                    className={`min-w-8 px-2.5 py-1.5 border rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      page === currentPage
                        ? 'border-[#2d6a55] bg-[#e8f2ee] text-[#2d6a55]'
                        : 'border-[#e4e1da] bg-white text-[#6b7063] hover:bg-[#f7f6f3]'
                    }`}
                  >
                    {page}
                  </button>
                </span>
              ))}
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Reject Candidate Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#e4e1da]">
            <div className="flex items-center justify-between p-5 border-b border-[#e4e1da]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#fdf2f2] rounded-lg flex items-center justify-center">
                  <XCircle className="w-4 h-4 text-[#b91c1c]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1c1c1a]">Reject Candidate</h3>
                  <p className="text-xs text-[#6b7063]">{rejectTarget.name}</p>
                </div>
              </div>
              <button onClick={() => setRejectTarget(null)} className="text-[#a8a49d] hover:text-[#1c1c1a] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">HR Feedback / Internal Notes</label>
                <textarea
                  value={rejectFeedback}
                  onChange={(e) => setRejectFeedback(e.target.value)}
                  placeholder="Optional internal notes for the hiring team..."
                  className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">Rejection Message (sent to candidate)</label>
                <textarea
                  value={rejectMessage}
                  onChange={(e) => setRejectMessage(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
                  rows={4}
                />
              </div>
            </div>
            <div className="flex gap-2 p-5 pt-0">
              <button
                onClick={() => setRejectTarget(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-[#e4e1da] text-[#6b7063] rounded-lg hover:bg-[#f7f6f3] text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const email = rejectTarget.managementEmail || rejectTarget.email;
                  runAction(email, () => onReject(email, rejectTarget.jobId, rejectFeedback, rejectMessage));
                  setRejectTarget(null);
                }}
                className="flex-1 px-4 py-2.5 bg-[#b91c1c] text-white rounded-lg hover:bg-[#991b1b] text-sm font-medium transition-colors"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Interview Modal */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#e4e1da]">
            <div className="flex items-center justify-between p-5 border-b border-[#e4e1da]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#eef2ff] rounded-lg flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-[#3730a3]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#1c1c1a]">Schedule Interview</h3>
                  <p className="text-xs text-[#6b7063]">{scheduleTarget.name}</p>
                </div>
              </div>
              <button onClick={() => setScheduleTarget(null)} className="text-[#a8a49d] hover:text-[#1c1c1a] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">Date *</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#3730a3]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">Time *</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#3730a3]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">Location</label>
                <input
                  value={scheduleLocation}
                  onChange={(e) => setScheduleLocation(e.target.value)}
                  placeholder="Office address, Zoom link, etc."
                  className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#3730a3]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#a8a49d] mb-1 font-medium font-semibold">Notes</label>
                <textarea
                  value={scheduleNotes}
                  onChange={(e) => setScheduleNotes(e.target.value)}
                  placeholder="Bring your portfolio, virtual meeting instructions, etc."
                  className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#3730a3] resize-none"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex gap-2 p-5 pt-0">
              <button
                onClick={() => setScheduleTarget(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-[#e4e1da] text-[#6b7063] rounded-lg hover:bg-[#f7f6f3] text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!scheduleDate || !scheduleTime}
                onClick={async () => {
                  const email = scheduleTarget.managementEmail || scheduleTarget.email;
                  const result: any = await runAction(email, () => onScheduleInterview(email, scheduleTarget.jobId, scheduleDate, scheduleTime, scheduleLocation, scheduleNotes));
                  if (result) {
                    toast.success(result.interview_email_sent
                      ? `Interview scheduled and email sent to ${scheduleTarget.name}.`
                      : result.smtp_configured === false
                        ? `Interview scheduled for ${scheduleTarget.name}. SMTP is not configured, so no email was sent.`
                        : `Interview scheduled for ${scheduleTarget.name}. Email delivery was not confirmed.`);
                  }
                  setScheduleTarget(null);
                }}
                className="flex-1 px-4 py-2.5 bg-[#3730a3] text-white rounded-lg hover:bg-[#312e81] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                Confirm Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trajectory Candidate Profile Modal */}
      {selectedTrajectoryCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-[#e4e1da] max-h-[90vh] overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-[#e4e1da] bg-[#f7f6f3]">
              <div className="flex items-start gap-4 min-w-0">
                {selectedTrajectoryCandidate.profilePictureUrl ? (
                  <img
                    src={`${API_ORIGIN}${selectedTrajectoryCandidate.profilePictureUrl}`}
                    alt={getDisplayName(selectedTrajectoryCandidate)}
                    className="w-14 h-14 rounded-xl object-cover border border-[#e4e1da] flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] font-semibold text-xl flex-shrink-0">
                    {getDisplayName(selectedTrajectoryCandidate).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55] font-semibold">Trajectory Candidate Profile</p>
                  <h3 className="text-lg text-[#1c1c1a] font-semibold truncate">{getDisplayName(selectedTrajectoryCandidate)}</h3>
                  <p className="text-sm text-[#6b7063] truncate">{getDisplayEmail(selectedTrajectoryCandidate)}</p>
                  <p className="text-xs text-[#a8a49d] mt-1">
                    {jobs.find(job => job.id === selectedTrajectoryCandidate.jobId)?.title || 'Sourced Position'} - {getCandidatePhase(selectedTrajectoryCandidate.status, selectedTrajectoryCandidate.answers)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedTrajectoryCandidate(null)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#a8a49d] hover:text-[#1c1c1a] hover:bg-white transition-colors flex-shrink-0"
                title="Close profile"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[calc(90vh-105px)] space-y-5">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-4">
                  <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Position Fit</p>
                  <p className="text-2xl text-[#2d6a55] font-semibold mt-1">{selectedTrajectoryCandidate.matchScore}%</p>
                </div>
                <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-4">
                  <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Trajectory</p>
                  <p className="text-2xl text-[#c9a84c] font-semibold mt-1">{selectedTrajectoryCandidate.trajectoryScore}%</p>
                </div>
                <div className="rounded-xl border border-[#e4e1da] bg-[#f7f6f3] p-4">
                  <p className="text-xs text-[#a8a49d] uppercase tracking-wider font-semibold">Screening</p>
                  <p className="text-2xl text-[#1c1c1a] font-semibold mt-1">{selectedTrajectoryCandidate.screeningScore ?? '--'}</p>
                </div>
              </div>

              <div className="rounded-xl border border-[#e4e1da] p-4">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Profile Summary</p>
                <p className="text-sm text-[#6b7063] leading-relaxed">
                  {selectedTrajectoryCandidate.about || selectedTrajectoryCandidate.resumeSummary || selectedTrajectoryCandidate.positionFitSummary || 'No profile summary is available yet.'}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#e4e1da] p-4">
                  <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Experience</p>
                  {selectedTrajectoryCandidate.experiences?.length ? (
                    <div className="space-y-2">
                      {selectedTrajectoryCandidate.experiences.slice(0, 3).map((experience, index) => (
                        <div key={`${experience.title}-${experience.company}-${index}`} className="rounded-lg bg-[#f7f6f3] border border-[#e4e1da] p-3">
                          <p className="text-sm text-[#1c1c1a] font-semibold">{experience.title || 'Experience'}</p>
                          <p className="text-xs text-[#6b7063] mt-0.5">{[experience.company, experience.duration].filter(Boolean).join(' - ') || 'Company details not found'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#6b7063]">No experience details extracted.</p>
                  )}
                </div>

                <div className="rounded-xl border border-[#e4e1da] p-4">
                  <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Education & Skills</p>
                  {selectedTrajectoryCandidate.education?.length ? (
                    <div className="space-y-2 mb-3">
                      {selectedTrajectoryCandidate.education.slice(0, 2).map((education, index) => (
                        <div key={`${education.degree}-${education.school}-${index}`} className="rounded-lg bg-[#f7f6f3] border border-[#e4e1da] p-3">
                          <p className="text-sm text-[#1c1c1a] font-semibold">{education.degree || 'Education'}</p>
                          <p className="text-xs text-[#6b7063] mt-0.5">{education.school || 'School details not found'}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {selectedTrajectoryCandidate.skills?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTrajectoryCandidate.skills.slice(0, 10).map(skill => (
                        <span key={skill} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">{skill}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#6b7063]">No skills extracted.</p>
                  )}
                </div>
              </div>

              {selectedTrajectoryCandidate.positionFitSummary && (
                <div className="rounded-xl border border-[#c8e6d8] bg-[#f8fcfa] p-4">
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-2 font-semibold">Position Fit Reasoning</p>
                  <p className="text-sm text-[#3d5a4a] leading-relaxed">{selectedTrajectoryCandidate.positionFitSummary}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
