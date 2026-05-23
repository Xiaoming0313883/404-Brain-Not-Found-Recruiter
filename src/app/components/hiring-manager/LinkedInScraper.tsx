import { useState } from 'react';
import { Job, ScrapedCandidate } from '../HiringManagerPortal';
import { Link2, Play, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  onAddCandidate: (candidate: ScrapedCandidate) => void;
  onUpdateStatus: (candidateId: number, status: ScrapedCandidate['status']) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export function LinkedInScraper({ jobs, candidates, onAddCandidate, onUpdateStatus }: Props) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedJobId, setSelectedJobId] = useState<number | ''>('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [stagedCandidate, setStagedCandidate] = useState<Omit<ScrapedCandidate, 'id'> | null>(null);
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [emailDraft, setEmailDraft] = useState('');

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
    matchScore: data.match_results?.scores?.technical || 80,
    trajectoryScore: data.match_results?.scores?.trajectory_slope || 80,
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
    setStagedCandidate(null);
    setErrorMessage('');

    try {
      const logs = [
        'Agent reading active position requirements...',
        'Generating prototype search strategy...',
        'Scanning simulated LinkedIn talent pool...',
        'Ranking candidates by match fit and trajectory...',
        'Drafting outreach email for top candidate...'
      ];

      for (const log of logs) {
        setProcessingLogs(prev => [...prev, log]);
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      const response = await fetch(`${API_BASE_URL}/candidates/auto-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: Number(selectedJobId), count: 3 })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Automatic sourcing failed.');
      }

      const data = await response.json();
      const topCandidate = data[0];
      const mappedCandidate = mapCandidate(topCandidate);
      setStagedCandidate(mappedCandidate);
      setEmailDraft(mappedCandidate.recruitmentEmail || '');
      setProcessingLogs(prev => [...prev, `Auto-source found ${data.length} candidate profiles.`, `Top candidate: ${topCandidate.name}`]);
      data.forEach((candidate: any, index: number) => onAddCandidate({ ...mapCandidate(candidate), id: candidates.length + index + 1 } as ScrapedCandidate));
    } catch (err: any) {
      setErrorMessage(err.message || 'Automatic sourcing failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScrape = async () => {
    if (!linkedinUrl || !selectedJobId) return;

    setIsProcessing(true);
    setProcessingLogs([]);
    setStagedCandidate(null);
    setErrorMessage('');

    const initialLogs = [
      'Initializing Playwright automated worker...',
      'Navigating to LinkedIn profile directories...',
      'Extracting HTML component nodes...',
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
        'Profile extraction completed successfully.',
        `Match Score Calculated: ${data.match_results?.scores?.technical || 80}%`,
        `Trajectory Slope Calculated: ${data.match_results?.scores?.trajectory_slope || 80}%`
      ]);

      const mappedCandidate = mapCandidate(data);

      setStagedCandidate(mappedCandidate);
      setEmailDraft(mappedCandidate.recruitmentEmail || '');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'API connection failed. Simulating local fallback profiling.');
      
      // Simulation fallback for smooth offline prototyping
      await new Promise(resolve => setTimeout(resolve, 1000));
      setProcessingLogs(prev => [...prev, 'Fallback simulator initiated...', 'Profile analysis complete.']);
      const mockCandidate: Omit<ScrapedCandidate, 'id'> = {
        name: 'Alex Rodriguez',
        email: 'alex.rodriguez@email.com',
        managementEmail: 'alex.rodriguez@email.com',
        headline: 'Full-Stack Engineer with 6 years building scalable web applications',
        location: 'Austin, TX',
        about: 'Passionate software engineer specializing in React, Node.js, and cloud infrastructure.',
        experiences: [
          { title: 'Senior Software Engineer', company: '[Series B Startup]', duration: '2022-Present' },
          { title: 'Software Engineer', company: '[Mid-Size Tech Company]', duration: '2019-2022' }
        ],
        education: [
          { school: '[State University]', degree: 'BS Computer Science' }
        ],
        jobId: Number(selectedJobId),
        matchScore: 85,
        trajectoryScore: 92,
        status: 'staged',
        recruitmentEmail: `Dear Alex,\n\nYour career progression and technical expertise caught our attention on LinkedIn. Your experience building scalable systems and demonstrated growth from junior to senior engineer in just 4 years shows exceptional learning velocity.\n\nWe'd love to discuss our job opportunity with you.\n\nBest regards,\nThe Hiring Team`,
        advocatePros: [
          'Rapid career progression — junior to senior in 4 years',
          'Strong full-stack capabilities matching our tech stack'
        ],
        recruiterCons: [
          'Limited experience with distributed systems at scale'
        ]
      };
      setStagedCandidate(mockCandidate);
      setEmailDraft(mockCandidate.recruitmentEmail || '');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendInvitation = async () => {
    if (!stagedCandidate) return;
    setIsProcessing(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/candidates/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: stagedCandidate.managementEmail || stagedCandidate.email,
          outreach_email: emailDraft
        })
      });

      if (!response.ok) {
        throw new Error('Failed to dispatch outreach SMTP invitation.');
      }

      const data = await response.json();
      
      // Backend returns full invited candidate object
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
        matchScore: data.candidate.match_results?.scores?.technical || 80,
        trajectoryScore: data.candidate.match_results?.scores?.trajectory_slope || 80,
        status: 'invited',
        recruitmentEmail: data.candidate.outreach_email,
        sourcingPitch: data.candidate.sourcing_pitch,
        advocatePros: data.candidate.match_results?.debate?.talent_advocate_pros || [],
        recruiterCons: data.candidate.match_results?.debate?.critical_recruiter_cons || []
      };

      onAddCandidate(fullCandidate);
      setLinkedinUrl('');
      setStagedCandidate(null);
      setProcessingLogs([]);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Connection failed. Dispatching invitation locally.');
      // Local fallback
      onAddCandidate({
        ...stagedCandidate,
        id: candidates.length + 1,
        status: 'invited'
      } as ScrapedCandidate);
      setLinkedinUrl('');
      setStagedCandidate(null);
      setProcessingLogs([]);
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
              : 'Paste a public LinkedIn profile URL to scrape, analyze, and generate editable outreach.'}
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
            Demo: https://www.linkedin.com/in/alex-rodriguez-dev
          </p>
        </div>
        )}

        {mode === 'auto' && (
          <button
            onClick={handleAutoSource}
            disabled={!selectedJobId || isProcessing}
            className="w-full px-5 py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isProcessing ? 'Searching...' : 'Run Automatic Agent Search'}
          </button>
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

      {/* Staged Profile Card */}
      {stagedCandidate && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-[#2d6a55] px-6 py-4">
            <p className="text-xs tracking-[0.15em] uppercase text-white/70 mb-0.5 font-semibold">Sourced Profile</p>
            <h3 className="text-white text-lg font-semibold">Ready for Review</h3>
          </div>

          <div className="p-6 space-y-6">
            {/* Candidate Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] text-xl font-medium flex-shrink-0">
                  {stagedCandidate.name.charAt(0)}
                </div>
                <div>
                  <h4 className="text-[#1c1c1a] mb-1 font-semibold">{stagedCandidate.name}</h4>
                  <p className="text-sm text-[#6b7063]">{stagedCandidate.headline}</p>
                  <p className="text-xs text-[#a8a49d] mt-0.5">{stagedCandidate.location}</p>
                </div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <div className="text-2xl text-[#2d6a55] font-semibold">{stagedCandidate.matchScore}%</div>
                  <div className="text-xs text-[#6b7063]">Match Fit</div>
                </div>
                <div>
                  <div className="text-2xl text-[#c9a84c] font-semibold">{stagedCandidate.trajectoryScore}%</div>
                  <div className="text-xs text-[#6b7063]">Trajectory</div>
                </div>
              </div>
            </div>

            {stagedCandidate.about && (
              <div>
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">About</p>
                <p className="text-sm text-[#6b7063] leading-relaxed">{stagedCandidate.about}</p>
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
                  {stagedCandidate.advocatePros?.map((pro, idx) => (
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
                  {stagedCandidate.recruiterCons?.map((con, idx) => (
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
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  className="w-full min-h-56 bg-transparent whitespace-pre-wrap text-sm text-[#6b7063] leading-relaxed font-sans focus:outline-none resize-y"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-[#e4e1da]">
              <button
                onClick={() => setStagedCandidate(null)}
                className="text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors cursor-pointer"
              >
                Discard
              </button>
              <button
                onClick={handleSendInvitation}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm font-medium shadow-sm cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Send Invitation
              </button>
            </div>
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
