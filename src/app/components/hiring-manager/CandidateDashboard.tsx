import { useState, useMemo } from 'react';
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
  UserCheck
} from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import * as Accordion from '@radix-ui/react-accordion';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';
import { motion } from 'motion/react';

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  neutralize: boolean;
  onToggleNeutralize: (active: boolean) => void;
  isLoading?: boolean;
  onRefresh: () => Promise<void> | void;
  onStatusChange: (email: string, status: ScrapedCandidate['status']) => Promise<void>;
  onInvite: (email: string) => Promise<void>;
  onDelete: (email: string) => Promise<void>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

export function CandidateDashboard({
  jobs,
  candidates,
  neutralize,
  onToggleNeutralize,
  isLoading,
  onRefresh,
  onStatusChange,
  onInvite,
  onDelete
}: Props) {
  const [anonymizedMode, setAnonymizedMode] = useState(false);
  const [busyEmail, setBusyEmail] = useState('');
  const [actionError, setActionError] = useState('');

  const activePositions = jobs.filter(job => job.isOpenForApplications).length;
  const totalCandidates = candidates.length;
  const screeningCompleted = candidates.filter(c => c.status === 'completed').length;

  const scatterData = useMemo(() => {
    return candidates.map(c => ({
      name: anonymizedMode ? `Candidate #${c.id.toString().padStart(4, '0')}` : c.name,
      matchScore: c.matchScore,
      trajectoryScore: c.trajectoryScore,
      candidate: c
    }));
  }, [candidates, anonymizedMode]);

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

  const sortedCandidates = [...candidates].sort((a, b) => b.matchScore - a.matchScore);

  const runAction = async (email: string, action: () => Promise<void> | void) => {
    setBusyEmail(email);
    setActionError('');
    try {
      await action();
    } catch (error: any) {
      setActionError(error.message || 'Candidate action failed.');
    } finally {
      setBusyEmail('');
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
              <span className="text-[#6b7063]">Match Score</span>
              <span className="text-[#2d6a55]">{data.matchScore}%</span>
            </div>
            <div className="flex justify-between gap-4 text-xs font-medium">
              <span className="text-[#6b7063]">Trajectory</span>
              <span className="text-[#c9a84c]">{data.trajectoryScore}%</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const kpiCards = [
    { label: 'Active Positions', value: activePositions, icon: Briefcase },
    { label: 'Total Candidates', value: totalCandidates, icon: Users },
    { label: 'Screening Completed', value: screeningCompleted, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#1c1c1a] text-xl font-semibold">Candidate Pipeline</h2>
          <p className="text-sm text-[#6b7063] mt-0.5">AI-powered analytics and bias mitigation</p>
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

      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Bias Mitigation Controls */}
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

      {/* Scatter Plot */}
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
            <p className="text-xs text-[#6b7063]">Match fit vs. learning velocity</p>
          </div>
        </div>

        {candidates.length > 0 ? (
          <>
            <div className="bg-[#f7f6f3] rounded-xl p-4 shadow-inner">
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e1da" />
                  <XAxis
                    type="number"
                    dataKey="matchScore"
                    name="Core Match Fit"
                    unit="%"
                    domain={[0, 100]}
                    label={{ value: 'Core Match Fit (%)', position: 'insideBottom', offset: -12, style: { fill: '#6b7063', fontSize: 12, fontWeight: 500 } }}
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
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#2d6a55]" />
                  <p className="text-xs text-[#2d6a55] uppercase tracking-wider font-semibold">High Match + High Trajectory</p>
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
          </div>
        )}
      </motion.div>

      {/* Active Pipeline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
            <Users className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
          </div>
          <div>
            <h3 className="text-[#1c1c1a] font-semibold text-base">Active Pipeline</h3>
            <p className="text-xs text-[#6b7063]">
              {sortedCandidates.length} {sortedCandidates.length === 1 ? 'candidate' : 'candidates'} in review
            </p>
          </div>
        </div>

        {sortedCandidates.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 bg-[#f0ede8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-[#c8c4bc]" />
            </div>
            <p className="text-sm text-[#1c1c1a] mb-1 font-semibold">No candidates in pipeline yet</p>
            <p className="text-xs text-[#6b7063]">Source candidates via LinkedIn or wait for inbound applications</p>
          </div>
        ) : (
          <Accordion.Root type="single" collapsible className="space-y-2.5">
            {sortedCandidates.map((candidate, index) => {
              const job = jobs.find(j => j.id === candidate.jobId);
              const displayName = getDisplayName(candidate);
              const displayEmail = getDisplayEmail(candidate);
              const actionEmail = getActionEmail(candidate);

              return (
                <motion.div
                  key={`${candidate.email}-${candidate.applicationId || candidate.jobId || index}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                >
                  <Accordion.Item
                    value={`candidate-${candidate.id}`}
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
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="text-sm text-[#1c1c1a] font-semibold">{displayName}</h4>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  candidate.status === 'invited' ? 'bg-[#e8f2ee] text-[#2d6a55]' :
                                  candidate.status === 'applied' ? 'bg-[#e8eef8] text-[#3a5d9e]' :
                                  candidate.status === 'completed' ? 'bg-[#fdf8ee] text-[#c9a84c]' :
                                  'bg-[#f0ede8] text-[#a8a49d]'
                                }`}>
                                  {candidate.status === 'invited' ? 'Invited' :
                                   candidate.status === 'applied' ? 'Applied' :
                                   candidate.status === 'completed' ? 'Completed' : 'Staged'}
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
                                <div className="text-xs text-[#a8a49d]">Match</div>
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

                        <div className="bg-white border border-[#e4e1da] rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <p className="text-xs tracking-wider uppercase text-[#a8a49d] font-semibold">Manage Candidate</p>
                            {busyEmail === actionEmail && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-[#2d6a55] font-semibold">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Updating
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {candidate.status === 'staged' && (
                              <button
                                onClick={() => runAction(actionEmail, () => onInvite(actionEmail))}
                                disabled={busyEmail === actionEmail}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 text-xs font-medium transition-colors"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                Send Invite
                              </button>
                            )}
                            {candidate.status !== 'screening' && candidate.status !== 'completed' && (
                              <button
                                onClick={() => runAction(actionEmail, () => onStatusChange(actionEmail, 'screening'))}
                                disabled={busyEmail === actionEmail}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] disabled:opacity-50 text-xs font-medium transition-colors"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Mark Screening
                              </button>
                            )}
                            {candidate.status !== 'completed' && (
                              <button
                                onClick={() => runAction(actionEmail, () => onStatusChange(actionEmail, 'completed'))}
                                disabled={busyEmail === actionEmail}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] disabled:opacity-50 text-xs font-medium transition-colors"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Mark Complete
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete ${candidate.name} from the pipeline?`)) {
                                  runAction(actionEmail, () => onDelete(actionEmail));
                                }
                              }}
                              disabled={busyEmail === actionEmail}
                              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#f0c9c9] text-[#b91c1c] rounded-lg hover:bg-[#fdf2f2] disabled:opacity-50 text-xs font-medium transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        </div>

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
                              <p className="text-[#1c1c1a] mt-0.5 font-medium">{candidate.location}</p>
                            </div>
                          </div>
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
                                <a
                                  href={`${API_ORIGIN}${candidate.resumeUrl}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-2 mb-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] text-xs font-medium transition-colors"
                                >
                                  Open Original PDF
                                </a>
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
                        {candidate.status === 'completed' && candidate.screeningScore !== undefined && (
                          <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                                <CheckCircle2 className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
                              </div>
                              <div>
                                <p className="text-sm text-[#1c1c1a] font-semibold">Screening Complete</p>
                                <p className="text-xs text-[#6b7063]">Interactive warm-up sandbox Q&A scored by AI</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-2xl text-[#2d6a55] font-semibold">{candidate.screeningScore}</div>
                              <div className="text-xs text-[#6b7063]">/ 100</div>
                            </div>
                          </div>
                        )}

                        {/* Email Preview */}
                        {candidate.recruitmentEmail && (
                          <details className="group bg-white border border-[#e4e1da] rounded-xl overflow-hidden shadow-sm">
                            <summary className="cursor-pointer px-4 py-3 hover:bg-[#f7f6f3] transition-colors flex items-center justify-between font-medium text-sm text-[#1c1c1a]">
                              <span className="text-sm text-[#6b7063] group-hover:text-[#1c1c1a] transition-colors">
                                View Outreach Email
                              </span>
                              <ChevronDown className="w-4 h-4 text-[#a8a49d] transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="px-4 pb-4 pt-2 border-t border-[#e4e1da]">
                              <pre className="whitespace-pre-wrap text-xs text-[#6b7063] leading-relaxed font-sans">
                                {candidate.recruitmentEmail}
                              </pre>
                            </div>
                          </details>
                        )}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                </motion.div>
              );
            })}
          </Accordion.Root>
        )}
      </motion.div>
    </div>
  );
}
