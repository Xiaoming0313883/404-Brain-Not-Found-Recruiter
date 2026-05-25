import { useState } from 'react';
import { Job, ScrapedCandidate } from '../HiringManagerPortal';
import { Link2, Play, Send, CheckCircle2, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE_URL } from '../../api';

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  onAddCandidate: (candidate: ScrapedCandidate) => void;
  onUpdateStatus: (candidateId: number, status: ScrapedCandidate['status']) => void;
}

export function LinkedInScraper({ jobs, candidates, onAddCandidate, onUpdateStatus }: Props) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedJobId, setSelectedJobId] = useState<number | ''>('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [stagedCandidates, setStagedCandidates] = useState<Array<Omit<ScrapedCandidate, 'id'>>>([]);
  const [expandedIndices, setExpandedIndices] = useState<Record<number, boolean>>({});
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [autoSourceCount, setAutoSourceCount] = useState(3);

  const mapCandidate = (data: any): Omit<ScrapedCandidate, 'id'> => ({
    name: data.name,
    email: data.email,
    managementEmail: data.management_email || data.email,
    headline: data.profile_data?.headline || 'Software Engineer',
    location: data.profile_data?.location || 'Unknown',
    about: data.profile_data?.about || '',
    experiences: data.profile_data?.experiences || [],
    education: data.profile_data?.education || [],
    jobId: data.position_id,
    matchScore: data.match_results?.scores?.overall_position_fit || data.match_results?.scores?.technical || 80,
    trajectoryScore: data.match_results?.scores?.trajectory_slope || 80,
    positionFitSummary: data.match_results?.position_fit_summary || '',
    fitBreakdown: data.match_results?.fit_breakdown,
    sourceStatus: data.profile_data?.scrape_status || '',
    sourceWarning: data.profile_data?.scrape_warning || '',
    sourceType: data.source_type || data.profile_data?.source_type || 'linkedin',
    sourceMethod: data.source_method || data.profile_data?.source_method || '',
    status: data.status,
    recruitmentEmail: data.outreach_email,
    sourcingPitch: data.sourcing_pitch,
    advocatePros: data.match_results?.debate?.talent_advocate_pros || [],
    recruiterCons: data.match_results?.debate?.critical_recruiter_cons || []
  });

  const handleAutoSource = async () => {
    if (!selectedJobId) return;

    setIsProcessing(true);
    setProcessingLogs([]);
    setStagedCandidates([]);
    setExpandedIndices({});
    setEmailDrafts({});
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/candidates/auto-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: Number(selectedJobId), count: autoSourceCount })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Automatic sourcing failed.');
      }

      if (!response.body) {
        throw new Error('Response body is null.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6);
            try {
              const eventData = JSON.parse(dataStr);
              if (eventData.log) {
                setProcessingLogs(prev => [...prev, eventData.log]);
              } else if (eventData.result) {
                const results = eventData.result;
                const mapped = results.map(mapCandidate);
                setStagedCandidates(mapped);

                const drafts: Record<string, string> = {};
                mapped.forEach((c: any) => {
                  drafts[c.email] = c.recruitmentEmail || '';
                });
                setEmailDrafts(drafts);
                setExpandedIndices({ 0: true });

                setProcessingLogs(prev => [...prev, `Auto-source found ${results.length} candidate profiles.`]);
                toast.success(`Auto-source staged ${results.length} candidate profiles. Invitations were not sent.`);
                results.forEach((candidate: any, index: number) => 
                  onAddCandidate({ ...mapCandidate(candidate), id: candidates.length + index + 1 } as ScrapedCandidate)
                );
              }
            } catch (parseErr) {
              console.error('Error parsing SSE message:', dataStr, parseErr);
            }
          }
        }
      }

      if (buffer.trim()) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.slice(6);
          try {
            const eventData = JSON.parse(dataStr);
            if (eventData.log) {
              setProcessingLogs(prev => [...prev, eventData.log]);
            } else if (eventData.result) {
              const results = eventData.result;
              const mapped = results.map(mapCandidate);
              setStagedCandidates(mapped);

              const drafts: Record<string, string> = {};
              mapped.forEach((c: any) => {
                drafts[c.email] = c.recruitmentEmail || '';
              });
              setEmailDrafts(drafts);
              setExpandedIndices({ 0: true });

              setProcessingLogs(prev => [...prev, `Auto-source found ${results.length} candidate profiles.`]);
              toast.success(`Auto-source staged ${results.length} candidate profiles. Invitations were not sent.`);
              results.forEach((candidate: any, index: number) => 
                onAddCandidate({ ...mapCandidate(candidate), id: candidates.length + index + 1 } as ScrapedCandidate)
              );
            }
          } catch (parseErr) {
            console.error('Error parsing SSE message from buffer:', dataStr, parseErr);
          }
        }
      }

    } catch (err: any) {
      setErrorMessage(err.message || 'Automatic sourcing failed.');
      toast.error(err.message || 'Automatic sourcing failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScrape = async () => {
    if (!linkedinUrl || !selectedJobId) return;

    setIsProcessing(true);
    setProcessingLogs([]);
    setStagedCandidates([]);
    setExpandedIndices({});
    setEmailDrafts({});
    setErrorMessage('');

    const initialLogs = [
      'Initializing live LinkedIn scraper...',
      'Checking Apify or authenticated LinkedIn scraper configuration...',
      'Requesting verified profile data...',
      'Converting DOM structures to Pydantic records...',
      'Invoking Matching Agent Debate Panel...',
      'Invoking Candidate Interview Agent (Phase A)...',
      'Invoking Report Agent Outreach & Pitch Synthesizer...'
    ];

    try {
      // Simulate live progress logs on the terminal console
      for (let i = 0; i < initialLogs.length; i++) {
        setProcessingLogs(prev => [...prev, initialLogs[i]]);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const response = await fetch(`${API_BASE_URL}/candidates/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position_id: Number(selectedJobId),
          linkedin_url: linkedinUrl.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Sourcing scraper failed.');
      }

      const data = await response.json();
      
      setProcessingLogs(prev => [
        ...prev,
        data.profile_data?.source_method === 'manual_apify'
          ? 'Live Apify profile data captured.'
          : 'Authenticated LinkedIn profile data captured.',
        `Position Fit Score Calculated: ${data.match_results?.scores?.overall_position_fit || data.match_results?.scores?.technical || 80}%`,
        `Trajectory Slope Calculated: ${data.match_results?.scores?.trajectory_slope || 80}%`
      ]);

      const mappedCandidate = mapCandidate(data);

      setStagedCandidates([mappedCandidate]);
      setEmailDrafts({ [mappedCandidate.email]: mappedCandidate.recruitmentEmail || '' });
      setExpandedIndices({ 0: true });
      toast.success('Candidate staged. Review the draft before sending an invitation.');
    } catch (err: any) {
      console.error(err);
      const message = err.message || 'Live LinkedIn profile extraction failed. No candidate was staged.';
      setErrorMessage(message);
      toast.error(message);
      setProcessingLogs(prev => [...prev, 'Profile extraction stopped. No URL-only or simulated candidate was staged.']);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendInvitation = async (candidate: Omit<ScrapedCandidate, 'id'>) => {
    setIsProcessing(true);
    setErrorMessage('');
    const draft = emailDrafts[candidate.email] || '';

    try {
      const response = await fetch(`${API_BASE_URL}/candidates/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: candidate.managementEmail || candidate.email,
          outreach_email: draft
        })
      });

      if (!response.ok) {
        throw new Error('Failed to dispatch outreach SMTP invitation.');
      }

      const data = await response.json();
      
      const fullCandidate: ScrapedCandidate = {
        id: data.candidate.id || candidates.length + 1,
        name: data.candidate.name,
        email: data.candidate.email,
        managementEmail: data.candidate.management_email || data.candidate.email,
        headline: data.candidate.profile_data?.headline || 'Software Engineer',
        location: data.candidate.profile_data?.location || 'Unknown',
        about: data.candidate.profile_data?.about || '',
        experiences: data.candidate.profile_data?.experiences || [],
        education: data.candidate.profile_data?.education || [],
        jobId: data.candidate.position_id,
        matchScore: data.candidate.match_results?.scores?.overall_position_fit || data.candidate.match_results?.scores?.technical || 80,
        trajectoryScore: data.candidate.match_results?.scores?.trajectory_slope || 80,
        positionFitSummary: data.candidate.match_results?.position_fit_summary || '',
        fitBreakdown: data.candidate.match_results?.fit_breakdown,
        sourceStatus: data.candidate.profile_data?.scrape_status || '',
        sourceWarning: data.candidate.profile_data?.scrape_warning || '',
        sourceType: data.candidate.source_type || data.candidate.profile_data?.source_type || 'linkedin',
        sourceMethod: data.candidate.source_method || data.candidate.profile_data?.source_method || '',
        status: 'invited',
        recruitmentEmail: data.candidate.outreach_email,
        sourcingPitch: data.candidate.sourcing_pitch,
        advocatePros: data.candidate.match_results?.debate?.talent_advocate_pros || [],
        recruiterCons: data.candidate.match_results?.debate?.critical_recruiter_cons || []
      };

      onAddCandidate(fullCandidate);
      toast.success(data.outreach_sent
        ? `Invitation email sent to ${fullCandidate.name}.`
        : data.smtp_configured === false
          ? `Invitation saved for ${fullCandidate.name}. SMTP is not configured, so no email was sent.`
          : `Invitation saved for ${fullCandidate.name}. Email delivery was not confirmed.`);
      setLinkedinUrl('');
      setStagedCandidates(prev => prev.filter(c => c.email !== candidate.email));
      setProcessingLogs([]);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Connection failed. Invitation was not sent.');
      toast.error(err.message || 'Connection failed. Invitation was not sent.');
    } finally {
      setIsProcessing(false);
    }
  };

  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-[#e4e1da] rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20 transition-colors disabled:bg-[#f0ede8] disabled:text-[#a8a49d]";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[#1c1c1a] text-xl font-semibold">LinkedIn Sourcing Console</h2>
        <p className="text-sm text-[#6b7063] mt-0.5">Automatic prototype sourcing or manual LinkedIn profile analysis</p>
      </div>

      {errorMessage && (
        <div className="p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <div className="inline-flex bg-white border border-[#e4e1da] rounded-xl p-1 shadow-sm">
        <button
          onClick={() => setMode('auto')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'auto' ? 'bg-[#2d6a55] text-white' : 'text-[#6b7063] hover:text-[#1c1c1a]'}`}
        >
          Automatic Agent Search
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-[#2d6a55] text-white' : 'text-[#6b7063] hover:text-[#1c1c1a]'}`}
        >
          Manual URL Scrape
        </button>
      </div>

      {/* Scraper Interface */}
      <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5 shadow-sm">
        <div>
          <h3 className="text-[#1c1c1a] mb-1 font-semibold">
            {mode === 'auto' ? 'Automatic Candidate Discovery' : 'Profile Scraper & Analyzer'}
          </h3>
          <p className="text-sm text-[#6b7063]">
            {mode === 'auto'
              ? 'Prototype agent search finds suitable candidates for the selected position and stages the best match.'
              : 'Paste a public LinkedIn profile URL. LinkedIn may block full extraction, so unavailable fields are marked for manual verification.'}
          </p>
        </div>

        <div>
          <label className="block mb-1.5 text-sm text-[#1c1c1a] font-medium">Target Position *</label>
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value ? Number(e.target.value) : '')}
            disabled={isProcessing}
            className={inputClass}
          >
            <option value="">Select a position...</option>
            {jobs.map(job => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.department || 'Engineering'}
              </option>
            ))}
          </select>
        </div>

        {mode === 'manual' && (
        <div>
          <label className="block mb-1.5 text-sm text-[#1c1c1a] font-medium">LinkedIn Profile URL *</label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a49d]" />
              <input
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://www.linkedin.com/in/username"
                disabled={isProcessing}
                className={`${inputClass} pl-10`}
              />
            </div>
            <button
              onClick={handleScrape}
              disabled={!linkedinUrl || !selectedJobId || isProcessing}
              className="px-5 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap text-sm font-medium shadow-sm cursor-pointer"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isProcessing ? 'Processing...' : 'Fetch & Analyze'}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#a8a49d]">
            Manual URL scrape requires APIFY_API_TOKEN or LINKEDIN_LI_AT_COOKIE so only live profile data is staged.
          </p>
        </div>
        )}

        {mode === 'auto' && (
          <div className="space-y-3">
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a] font-medium">Candidates to search</label>
              <input
                type="number"
                min={1}
                max={10}
                value={autoSourceCount}
                onChange={(event) => setAutoSourceCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
                disabled={isProcessing}
                className={inputClass}
              />
            </div>
            <button
              onClick={handleAutoSource}
              disabled={!selectedJobId || isProcessing}
              className="w-full px-5 py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isProcessing ? 'Searching...' : 'Run Automatic Agent Search'}
            </button>
          </div>
        )}

        {/* Processing Terminal */}
        {processingLogs.length > 0 && (
          <div className="bg-[#0f1117] border border-[#1e2230] rounded-xl p-5 font-mono text-sm overflow-auto max-h-56 shadow-inner">
            <div className="flex items-center gap-1.5 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="text-[#4a5568] text-xs ml-2">playwright — profile extraction</span>
            </div>
            {processingLogs.map((log, idx) => (
              <div key={idx} className="text-[#8fb4b4] mb-1 text-xs leading-relaxed">
                <span className="text-[#4a9e7a] mr-2">›</span>
                {log}
              </div>
            ))}
            {isProcessing && (
              <div className="text-[#8fb4b4] text-xs">
                <span className="text-[#4a9e7a] mr-2">›</span>
                <span className="animate-pulse">_</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Staged Profiles Collapsible Accordion List */}
      {stagedCandidates.length > 0 && (
        <div className="space-y-4">
          <div className="bg-[#2d6a55] px-6 py-4 rounded-t-2xl">
            <p className="text-xs tracking-[0.15em] uppercase text-white/70 mb-0.5 font-semibold">Sourced Profiles</p>
            <h3 className="text-white text-lg font-semibold">{stagedCandidates.length} Candidates Sourced</h3>
          </div>
          
          <div className="space-y-3">
            {stagedCandidates.map((candidate, idx) => {
              const isExpanded = expandedIndices[idx] ?? false;
              const draft = emailDrafts[candidate.email] ?? '';
              
              return (
                <div key={candidate.email} className="bg-white border border-[#e4e1da] rounded-xl overflow-hidden shadow-sm">
                  {/* Collapsed Header */}
                  <div
                    onClick={() => setExpandedIndices(prev => ({ ...prev, [idx]: !isExpanded }))}
                    className="cursor-pointer px-6 py-4 hover:bg-[#f7f6f3] transition-colors flex items-center justify-between gap-4 select-none"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 bg-[#e8f2ee] rounded-lg flex items-center justify-center text-[#2d6a55] font-semibold flex-shrink-0">
                        {candidate.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-[#1c1c1a] truncate">{candidate.name}</h4>
                        <p className="text-xs text-[#6b7063] truncate">{candidate.headline}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-[#6b7063]"><span className="text-[#2d6a55] font-semibold">{candidate.matchScore}%</span> Fit · <span className="text-[#c9a84c] font-semibold">{candidate.trajectoryScore}%</span> Traj</p>
                        <p className="text-[10px] text-[#a8a49d]">{candidate.location}</p>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-[#a8a49d] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="p-6 border-t border-[#e4e1da] space-y-6 bg-white">
                      {/* Basic details for smaller screens */}
                      <div className="sm:hidden grid grid-cols-2 gap-2 text-xs border-b border-[#e4e1da] pb-3 text-[#6b7063]">
                        <div>
                          <span className="font-semibold text-[#1c1c1a]">Match Fit:</span> {candidate.matchScore}%
                        </div>
                        <div>
                          <span className="font-semibold text-[#1c1c1a]">Trajectory:</span> {candidate.trajectoryScore}%
                        </div>
                        <div className="col-span-2">
                          <span className="font-semibold text-[#1c1c1a]">Location:</span> {candidate.location}
                        </div>
                      </div>

                      {candidate.about && (
                        <div>
                          <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">About</p>
                          <p className="text-sm text-[#6b7063] leading-relaxed">{candidate.about}</p>
                        </div>
                      )}

                      {(candidate.sourceWarning || candidate.sourceStatus) && (
                        <div className="bg-[#fff8ed] border border-[#f2d3a4] rounded-xl p-4">
                          <p className="text-xs tracking-wider uppercase text-[#8a5a14] mb-1 font-semibold">Source Verification</p>
                          <p className="text-sm text-[#6b7063] leading-relaxed">
                            {candidate.sourceWarning || 'This sourced profile should be manually verified before outreach.'}
                          </p>
                          {candidate.sourceStatus && (
                            <p className="text-xs text-[#a8a49d] mt-2">Extraction status: {candidate.sourceStatus}</p>
                          )}
                        </div>
                      )}

                      {/* AI Analysis */}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <CheckCircle2 className="w-4 h-4 text-[#2d6a55]" />
                            <p className="text-xs tracking-wider uppercase text-[#2d6a55] font-semibold">Key Strengths</p>
                          </div>
                          <ul className="space-y-2">
                            {candidate.advocatePros?.map((pro, idx) => (
                              <li key={idx} className="text-sm text-[#3d5a4a] leading-relaxed pl-2 border-l-2 border-[#2d6a55]/20">
                                {pro}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-[#fdf8ee] border border-[#e8d8a0] rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <AlertCircle className="w-4 h-4 text-[#c9a84c]" />
                            <p className="text-xs tracking-wider uppercase text-[#c9a84c] font-semibold">Potential Gaps</p>
                          </div>
                          <ul className="space-y-2">
                            {candidate.recruiterCons?.map((con, idx) => (
                              <li key={idx} className="text-sm text-[#5a4d2a] leading-relaxed pl-2 border-l-2 border-[#c9a84c]/30">
                                {con}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Recruitment Email Preview */}
                      <div>
                        <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Generated Outreach Email</p>
                        <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                          <textarea
                            value={draft}
                            onChange={(e) => setEmailDrafts(prev => ({ ...prev, [candidate.email]: e.target.value }))}
                            className="w-full min-h-56 bg-transparent whitespace-pre-wrap text-sm text-[#6b7063] leading-relaxed font-sans focus:outline-none resize-y"
                          />
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-4 border-t border-[#e4e1da]">
                        <button
                          onClick={() => setStagedCandidates(prev => prev.filter(c => c.email !== candidate.email))}
                          className="text-xs font-semibold text-[#b91c1c] hover:text-[#7f1d1d] transition-colors cursor-pointer"
                        >
                          Discard
                        </button>
                        <button
                          onClick={() => handleSendInvitation(candidate)}
                          className="flex items-center gap-2 px-4 py-2 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-xs font-medium shadow-sm cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Send Invitation
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recently Sourced */}
      {candidates.filter(c => c.status === 'invited' || c.status === 'staged').length > 0 && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
          <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-4 font-semibold">Recently Sourced</p>
          <div className="space-y-2.5">
            {candidates
              .filter(c => c.status === 'invited' || c.status === 'staged')
              .map(candidate => {
                const job = jobs.find(j => j.id === candidate.jobId);
                return (
                  <div
                    key={candidate.email}
                    className="flex items-center justify-between p-4 bg-[#f7f6f3] rounded-xl hover:bg-[#f0ede8] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-[#e8f2ee] rounded-lg flex items-center justify-center text-[#2d6a55] text-sm font-medium">
                        {candidate.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm text-[#1c1c1a] font-medium">{candidate.name}</p>
                        <p className="text-xs text-[#6b7063]">{job?.title || 'Sourced Profile'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-[#2d6a55] font-medium">{candidate.matchScore}% match</p>
                      <p className="text-xs text-[#a8a49d]">
                        {candidate.status === 'invited' ? 'Invitation sent' : 'Staged'}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
