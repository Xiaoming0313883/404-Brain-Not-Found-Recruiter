import { useMemo, useState } from 'react';
import { Loader2, RefreshCcw, ShieldCheck, Trash2, UserCheck, UserCog, KeyRound, Eye, X, FileText, Calendar } from 'lucide-react';
import { PdfResumeViewer } from '../PdfResumeViewer';
import { motion } from 'motion/react';
import { ScrapedCandidate } from '../HiringManagerPortal';

interface Props {
  candidates: ScrapedCandidate[];
  neutralize: boolean;
  isLoading?: boolean;
  onRefresh: () => Promise<void> | void;
  onDelete: (email: string) => Promise<void>;
  onUpdateAccount: (email: string, updates: { emailVerified?: boolean; profileVerified?: boolean }) => Promise<void>;
  onResetPassword: (email: string) => Promise<string>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');
const PAGE_SIZE = 10;

const getVisiblePages = (currentPage: number, totalPages: number) => {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return Array.from(pages)
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
};

export function CandidateAccountsPage({
  candidates,
  neutralize,
  isLoading,
  onRefresh,
  onDelete,
  onUpdateAccount,
  onResetPassword
}: Props) {
  const [anonymizedMode] = useState(false);
  const [busyEmail, setBusyEmail] = useState('');
  const [actionError, setActionError] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'all' | 'verified' | 'unverified' | 'password_set' | 'password_missing'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [passwordResetMessage, setPasswordResetMessage] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<ScrapedCandidate | null>(null);

  const getActionEmail = (candidate: ScrapedCandidate): string =>
    candidate.managementEmail || candidate.email;

  const getDisplayName = (candidate: ScrapedCandidate): string =>
    anonymizedMode || neutralize ? `Candidate #${candidate.id.toString().padStart(4, '0')}` : candidate.name;

  const getDisplayEmail = (candidate: ScrapedCandidate): string =>
    anonymizedMode || neutralize ? `candidate${candidate.id}@anonymized.local` : getActionEmail(candidate);

  const candidateAccounts = useMemo(() => {
    const accounts = new Map<string, ScrapedCandidate>();
    candidates.forEach(candidate => {
      const emailKey = getActionEmail(candidate).toLowerCase();
      const existing = accounts.get(emailKey);
      if (!existing || (candidate.applicationCount || 0) > (existing.applicationCount || 0)) {
        accounts.set(emailKey, candidate);
      }
    });
    return Array.from(accounts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return candidateAccounts.filter(candidate => {
      const accountEmail = getActionEmail(candidate).toLowerCase();
      const matchesQuery = !query
        || candidate.name.toLowerCase().includes(query)
        || accountEmail.includes(query);
      const matchesFilter =
        accountFilter === 'all'
        || (accountFilter === 'verified' && candidate.emailVerified)
        || (accountFilter === 'unverified' && !candidate.emailVerified)
        || (accountFilter === 'password_set' && candidate.hasPassword)
        || (accountFilter === 'password_missing' && !candidate.hasPassword);
      return matchesQuery && matchesFilter;
    });
  }, [accountFilter, accountSearch, candidateAccounts]);

  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedAccounts = filteredAccounts.slice((currentPageSafe - 1) * PAGE_SIZE, currentPageSafe * PAGE_SIZE);
  const visiblePages = getVisiblePages(currentPageSafe, totalPages);

  const runAction = async (email: string, action: () => Promise<void> | void) => {
    setBusyEmail(email);
    setActionError('');
    try {
      await action();
    } catch (error: any) {
      setActionError(error.message || 'Candidate account action failed.');
    } finally {
      setBusyEmail('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#1c1c1a] text-xl font-semibold">Candidate Accounts</h2>
          <p className="text-sm text-[#6b7063] mt-0.5">Manage verification, passwords, and account records.</p>
        </div>
        <button
          onClick={() => onRefresh()}
          className="inline-flex items-center justify-center w-9 h-9 bg-white border border-[#e4e1da] rounded-lg text-[#6b7063] hover:text-[#1c1c1a] hover:bg-[#f7f6f3] transition-colors"
          title="Refresh candidate accounts"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
        </button>
      </div>

      {actionError && (
        <div className="bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl p-4 text-sm">
          {actionError}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 mb-5 border-b border-[#e4e1da] pb-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <UserCog className="w-4.5 h-4.5 text-[#2d6a55]" style={{ width: '18px', height: '18px' }} />
              </div>
              <div>
                <h3 className="text-[#1c1c1a] font-semibold text-base">Account Directory</h3>
                <p className="text-xs text-[#6b7063]">
                  {filteredAccounts.length} of {candidateAccounts.length} registered {candidateAccounts.length === 1 ? 'account' : 'accounts'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={accountSearch}
                onChange={(event) => {
                  setAccountSearch(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search name or email"
                className="min-w-56 px-3 py-2 bg-white border border-[#e4e1da] rounded-lg text-xs text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55]"
              />
              <select
                value={accountFilter}
                onChange={(event) => {
                  setAccountFilter(event.target.value as typeof accountFilter);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 bg-white border border-[#e4e1da] rounded-lg text-xs text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              >
                <option value="all">All accounts</option>
                <option value="verified">Email verified</option>
                <option value="unverified">Email unverified</option>
                <option value="password_set">Password set</option>
                <option value="password_missing">Password missing</option>
              </select>
            </div>
          </div>

          {passwordResetMessage && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-xs text-[#8a5a14]">
              <span>{passwordResetMessage}</span>
              <button onClick={() => setPasswordResetMessage('')} className="text-[#8a5a14] hover:text-[#5a3b0d] font-bold leading-none">x</button>
            </div>
          )}
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 bg-[#f0ede8] rounded-2xl flex items-center justify-center mx-auto mb-3">
              <UserCog className="w-6 h-6 text-[#c8c4bc]" />
            </div>
            <p className="text-sm text-[#1c1c1a] mb-1 font-semibold">No candidate accounts match this filter</p>
            <p className="text-xs text-[#6b7063]">Try a different account status or search term.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {paginatedAccounts.map(candidate => {
              const accountEmail = getActionEmail(candidate);
              const displayName = getDisplayName(candidate);
              const displayEmail = getDisplayEmail(candidate);
              const isBusy = busyEmail === accountEmail;
              return (
                <div key={accountEmail} className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-4 bg-[#f7f6f3] border border-[#e4e1da] rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    {candidate.profilePictureUrl ? (
                      <img
                        src={`${API_ORIGIN}${candidate.profilePictureUrl}`}
                        alt={displayName}
                        className="w-11 h-11 rounded-xl object-cover border border-[#e4e1da]"
                      />
                    ) : (
                      <div className="w-11 h-11 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] font-semibold flex-shrink-0">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-[#1c1c1a] font-semibold truncate">{displayName}</p>
                      <p className="text-xs text-[#6b7063] truncate">{displayEmail}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${candidate.emailVerified ? 'bg-[#e8f2ee] text-[#2d6a55]' : 'bg-[#fff8ed] text-[#8a5a14]'}`}>
                          {candidate.emailVerified ? 'Email verified' : 'Email unverified'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${candidate.hasPassword ? 'bg-[#e8eef8] text-[#3a5d9e]' : 'bg-[#fdf2f2] text-[#b91c1c]'}`}>
                          {candidate.hasPassword ? 'Password set' : 'No password'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${candidate.profileVerified ? 'bg-[#e8f2ee] text-[#2d6a55]' : 'bg-[#f0ede8] text-[#6b7063]'}`}>
                          {candidate.profileVerified ? 'Profile verified' : 'Profile pending'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white text-[#6b7063] border border-[#e4e1da]">
                          {candidate.applicationCount || 0} {(candidate.applicationCount || 0) === 1 ? 'application' : 'applications'}
                        </span>
                        {/* Candidate Status Badge */}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          candidate.status === 'invited' ? 'bg-[#e8f2ee] text-[#2d6a55]' :
                          candidate.status === 'applied' ? 'bg-[#e8eef8] text-[#3a5d9e]' :
                          candidate.status === 'screening' ? 'bg-[#fdf0e6] text-[#c25a2a]' :
                          candidate.status === 'completed' ? 'bg-[#fdf8ee] text-[#c9a84c]' :
                          candidate.status === 'hired' ? 'bg-[#e8f2ee] text-[#245747]' :
                          candidate.status === 'rejected' ? 'bg-[#fdf2f2] text-[#b91c1c]' :
                          candidate.status === 'interview_scheduled' ? 'bg-[#eef2ff] text-[#3730a3]' :
                          'bg-[#f0ede8] text-[#a8a49d]'
                        }`}>
                          {candidate.status === 'invited' ? 'Invited' :
                           candidate.status === 'applied' ? 'Applied' :
                           candidate.status === 'screening' ? 'Screening' :
                           candidate.status === 'completed' ? 'Completed' :
                           candidate.status === 'hired' ? 'Hired' :
                           candidate.status === 'rejected' ? 'Rejected' :
                           candidate.status === 'interview_scheduled' ? 'Interview Scheduled' :
                           'Staged'}
                        </span>
                        {/* Interview Date — only shown when scheduled */}
                        {candidate.status === 'interview_scheduled' && candidate.interviewSlot && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#eef2ff] text-[#3730a3] border border-[#c7d2fe]">
                            <Calendar className="w-3 h-3" />
                            {candidate.interviewSlot.date} {candidate.interviewSlot.time}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <button
                      onClick={() => setSelectedCandidate(candidate)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-[#e8f2ee] text-[#2d6a55] rounded-lg hover:bg-[#d8eadd] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Candidate
                    </button>
                    <button
                      onClick={() => {
                        if (!window.confirm(`Reset password for ${candidate.name}? A temporary password will be generated.`)) return;
                        runAction(accountEmail, async () => {
                          const temporaryPassword = await onResetPassword(accountEmail);
                          setPasswordResetMessage(`Temporary password for ${candidate.name}: ${temporaryPassword}`);
                        });
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#e4e1da] text-[#3a5d9e] rounded-lg hover:bg-[#e8eef8] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      Reset Password
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete candidate account for ${candidate.name}? This removes their profile and application records.`)) {
                          runAction(accountEmail, () => onDelete(accountEmail));
                        }
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#f0c9c9] text-[#b91c1c] rounded-lg hover:bg-[#fdf2f2] disabled:opacity-50 text-xs font-medium transition-colors cursor-pointer"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete Account
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#e4e1da] pt-5 mt-5">
            <span className="text-xs text-[#6b7063]">
              Showing {Math.min(filteredAccounts.length, (currentPageSafe - 1) * PAGE_SIZE + 1)} to {Math.min(filteredAccounts.length, currentPageSafe * PAGE_SIZE)} of {filteredAccounts.length} accounts
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                disabled={currentPageSafe === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              {visiblePages.map((page, index) => (
                <span key={page} className="inline-flex items-center gap-1.5">
                  {index > 0 && page - visiblePages[index - 1] > 1 && <span className="px-1 text-xs text-[#a8a49d]">...</span>}
                  <button
                    onClick={() => setCurrentPage(page)}
                    className={`min-w-8 px-2.5 py-1.5 border rounded-lg text-xs font-semibold transition-colors ${
                      page === currentPageSafe
                        ? 'border-[#2d6a55] bg-[#e8f2ee] text-[#2d6a55]'
                        : 'border-[#e4e1da] bg-white text-[#6b7063] hover:bg-[#f7f6f3]'
                    }`}
                  >
                    {page}
                  </button>
                </span>
              ))}
              <button
                disabled={currentPageSafe === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-3 py-1.5 border border-[#e4e1da] bg-white rounded-lg text-xs font-semibold text-[#6b7063] hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {selectedCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 md:p-6">
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-[#e4e1da]">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#e4e1da] flex items-center justify-between bg-[#f7f6f3]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] font-semibold text-lg">
                  {selectedCandidate.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#1c1c1a]">{selectedCandidate.name}</h3>
                  <p className="text-xs text-[#6b7063]">{selectedCandidate.headline || 'Candidate Profile'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="w-8 h-8 rounded-lg hover:bg-[#e4e1da] flex items-center justify-center text-[#6b7063] hover:text-[#1c1c1a] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 grid md:grid-cols-2 gap-6">
              {/* Left Side: Profile Details */}
              <div className="space-y-5">
                <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider">Contact & Basic Info</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs text-[#6b7063]">
                    <div>
                      <span className="font-semibold text-[#1c1c1a]">Email</span>
                      <p className="mt-0.5 truncate">{selectedCandidate.managementEmail || selectedCandidate.email}</p>
                    </div>
                    {selectedCandidate.phone && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Phone</span>
                        <p className="mt-0.5">{selectedCandidate.phone}</p>
                      </div>
                    )}
                    {selectedCandidate.location && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Location</span>
                        <p className="mt-0.5">{selectedCandidate.location}</p>
                      </div>
                    )}
                    {selectedCandidate.age && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Age</span>
                        <p className="mt-0.5">{selectedCandidate.age}</p>
                      </div>
                    )}
                    {selectedCandidate.address && (
                      <div className="col-span-2">
                        <span className="font-semibold text-[#1c1c1a]">Address</span>
                        <p className="mt-0.5">{selectedCandidate.address}</p>
                      </div>
                    )}
                    {selectedCandidate.cameFrom && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Came From</span>
                        <p className="mt-0.5">{selectedCandidate.cameFrom}</p>
                      </div>
                    )}
                    {selectedCandidate.qualification && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Qualification</span>
                        <p className="mt-0.5">{selectedCandidate.qualification}</p>
                      </div>
                    )}
                    {selectedCandidate.gradeResults && (
                      <div>
                        <span className="font-semibold text-[#1c1c1a]">Grade / Results</span>
                        <p className="mt-0.5">{selectedCandidate.gradeResults}</p>
                      </div>
                    )}
                  </div>
                </div>

                {selectedCandidate.about && (
                  <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider mb-2">About Summary</h4>
                    <p className="text-xs text-[#6b7063] leading-relaxed whitespace-pre-wrap">{selectedCandidate.about}</p>
                  </div>
                )}

                {selectedCandidate.workExperience && (
                  <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider mb-2">Work Experience Description</h4>
                    <p className="text-xs text-[#6b7063] leading-relaxed whitespace-pre-wrap">{selectedCandidate.workExperience}</p>
                  </div>
                )}

                {selectedCandidate.skills && selectedCandidate.skills.length > 0 && (
                  <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider mb-2">Skills</h4>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedCandidate.skills.map((skill, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-white border border-[#e4e1da] text-[#6b7063] rounded-full text-xs font-medium">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCandidate.awards && selectedCandidate.awards.length > 0 && (
                  <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider mb-2">Awards</h4>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedCandidate.awards.map((award, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-white border border-[#e4e1da] text-[#6b7063] rounded-full text-xs font-medium">
                          {award}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Resume Viewer */}
              <div>
                <h4 className="text-xs font-semibold text-[#a8a49d] uppercase tracking-wider mb-3">Resume Document</h4>
                {selectedCandidate.resumeUrl ? (
                  <PdfResumeViewer url={`${API_ORIGIN}${selectedCandidate.resumeUrl}`} filename={selectedCandidate.resumeFilename} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-80 rounded-xl border-2 border-dashed border-[#e4e1da] bg-[#f7f6f3] text-center p-6 gap-3">
                    <FileText className="w-10 h-10 text-[#a8a49d]" />
                    <p className="text-sm font-semibold text-[#1c1c1a]">No Resume File Uploaded</p>
                    <p className="text-xs text-[#6b7063]">This profile was created without a PDF resume or via simulated LinkedIn sourcing.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
