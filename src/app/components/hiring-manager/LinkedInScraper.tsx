import { useState } from 'react';
import { Job, ScrapedCandidate } from '../HiringManagerPortal';
import { Link2, Play, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  onAddCandidate: (candidate: Omit<ScrapedCandidate, 'id'>) => void;
  onUpdateStatus: (candidateId: number, status: ScrapedCandidate['status']) => void;
}

export function LinkedInScraper({ jobs, candidates, onAddCandidate, onUpdateStatus }: Props) {
  const [selectedJobId, setSelectedJobId] = useState<number | ''>('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [stagedCandidate, setStagedCandidate] = useState<Omit<ScrapedCandidate, 'id'> | null>(null);
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);

  const handleScrape = async () => {
    if (!linkedinUrl || !selectedJobId) return;

    setIsProcessing(true);
    setProcessingLogs([]);
    setStagedCandidate(null);

    const logs = [
      'Initializing browser session...',
      'Navigating to profile URL...',
      'Extracting profile data...',
      'Parsing work experience...',
      'Parsing education history...',
      'Running Matching Agent similarity analysis...',
      'Match score calculated: 85%',
      'Calculating trajectory slope...',
      'Trajectory score: 92%',
      'Generating screening questions...',
      'Drafting outreach email...',
      'Profile analysis complete.',
    ];

    for (let i = 0; i < logs.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 180));
      setProcessingLogs(prev => [...prev, logs[i]]);
    }

    const mockCandidate: Omit<ScrapedCandidate, 'id'> = {
      name: 'Alex Rodriguez',
      email: 'alex.rodriguez@email.com',
      headline: 'Full-Stack Engineer with 6 years building scalable web applications',
      location: 'Austin, TX',
      about: 'Passionate software engineer specializing in React, Node.js, and cloud infrastructure. Love solving complex problems and mentoring junior developers.',
      experiences: [
        { title: 'Senior Software Engineer', company: '[Series B Startup]', duration: '2022-Present' },
        { title: 'Software Engineer', company: '[Mid-Size Tech Company]', duration: '2019-2022' },
        { title: 'Junior Developer', company: '[Tech Consultancy]', duration: '2018-2019' }
      ],
      education: [
        { school: '[State University]', degree: 'BS Computer Science' }
      ],
      jobId: Number(selectedJobId),
      matchScore: 85,
      trajectoryScore: 92,
      status: 'staged',
      recruitmentEmail: `Dear Alex,\n\nYour career progression and technical expertise caught our attention on LinkedIn. Your experience building scalable systems and demonstrated growth from junior to senior engineer in just 4 years shows exceptional learning velocity.\n\nWe'd love to discuss our ${jobs.find(j => j.id === selectedJobId)?.title} opportunity with you. Instead of a traditional interview, we've prepared a personalized technical warm-up that matches your skill level.\n\nBest regards,\nThe Hiring Team`,
      advocatePros: [
        'Rapid career progression — junior to senior in 4 years',
        'Strong full-stack capabilities matching our tech stack',
        'Demonstrated mentorship and leadership skills'
      ],
      recruiterCons: [
        'Limited experience with distributed systems at scale',
        'No direct industry-specific experience'
      ]
    };

    setStagedCandidate(mockCandidate);
    setIsProcessing(false);
  };

  const handleSendInvitation = () => {
    if (!stagedCandidate) return;
    onAddCandidate({ ...stagedCandidate, status: 'invited' });
    setLinkedinUrl('');
    setStagedCandidate(null);
    setProcessingLogs([]);
  };

  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-[#e4e1da] rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20 transition-colors disabled:bg-[#f0ede8] disabled:text-[#a8a49d]";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[#1c1c1a]">LinkedIn Sourcing Console</h2>
        <p className="text-sm text-[#6b7063] mt-0.5">Direct browser automation via Playwright</p>
      </div>

      {/* Scraper Interface */}
      <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5">
        <div>
          <h3 className="text-[#1c1c1a] mb-1">Profile Scraper & Analyzer</h3>
          <p className="text-sm text-[#6b7063]">
            Paste a public LinkedIn profile URL to automatically scrape, analyze, and generate personalized outreach.
          </p>
        </div>

        <div>
          <label className="block mb-1.5 text-sm text-[#1c1c1a]">Target Position *</label>
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value ? Number(e.target.value) : '')}
            disabled={isProcessing}
            className={inputClass}
          >
            <option value="">Select a position...</option>
            {jobs.map(job => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.department}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block mb-1.5 text-sm text-[#1c1c1a]">LinkedIn Profile URL *</label>
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
              className="px-5 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap text-sm"
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

        {/* Processing Terminal */}
        {processingLogs.length > 0 && (
          <div className="bg-[#0f1117] border border-[#1e2230] rounded-xl p-5 font-mono text-sm overflow-auto max-h-56">
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
        <div className="bg-white border border-[#2d6a55]/30 rounded-2xl overflow-hidden">
          <div className="bg-[#2d6a55] px-6 py-4">
            <p className="text-xs tracking-[0.15em] uppercase text-white/70 mb-0.5">Sourced Profile</p>
            <h3 className="text-white">Ready for Review</h3>
          </div>

          <div className="p-6 space-y-6">
            {/* Candidate Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-[#e8f2ee] rounded-xl flex items-center justify-center text-[#2d6a55] text-xl flex-shrink-0">
                  {stagedCandidate.name.charAt(0)}
                </div>
                <div>
                  <h4 className="text-[#1c1c1a] mb-1">{stagedCandidate.name}</h4>
                  <p className="text-sm text-[#6b7063]">{stagedCandidate.headline}</p>
                  <p className="text-xs text-[#a8a49d] mt-0.5">{stagedCandidate.location}</p>
                </div>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <div className="text-2xl text-[#2d6a55]">{stagedCandidate.matchScore}%</div>
                  <div className="text-xs text-[#6b7063]">Match Fit</div>
                </div>
                <div>
                  <div className="text-2xl text-[#c9a84c]">{stagedCandidate.trajectoryScore}%</div>
                  <div className="text-xs text-[#6b7063]">Trajectory</div>
                </div>
              </div>
            </div>

            {stagedCandidate.about && (
              <div>
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2">About</p>
                <p className="text-sm text-[#6b7063] leading-relaxed">{stagedCandidate.about}</p>
              </div>
            )}

            {/* AI Analysis */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-[#f0f9f4] border border-[#c8e6d8] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-[#2d6a55]" />
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55]">Key Strengths</p>
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
                  <p className="text-xs tracking-wider uppercase text-[#c9a84c]">Potential Gaps</p>
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
              <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2">Generated Outreach Email</p>
              <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-4">
                <pre className="whitespace-pre-wrap text-sm text-[#6b7063] leading-relaxed font-sans">
                  {stagedCandidate.recruitmentEmail}
                </pre>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-[#e4e1da]">
              <button
                onClick={() => setStagedCandidate(null)}
                className="text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleSendInvitation}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm"
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
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6">
          <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-4">Recently Sourced</p>
          <div className="space-y-2">
            {candidates
              .filter(c => c.status === 'invited' || c.status === 'staged')
              .map(candidate => {
                const job = jobs.find(j => j.id === candidate.jobId);
                return (
                  <div
                    key={candidate.id}
                    className="flex items-center justify-between p-4 bg-[#f7f6f3] rounded-xl hover:bg-[#f0ede8] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-[#e8f2ee] rounded-lg flex items-center justify-center text-[#2d6a55] text-sm">
                        {candidate.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm text-[#1c1c1a]">{candidate.name}</p>
                        <p className="text-xs text-[#6b7063]">{job?.title}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-[#2d6a55]">{candidate.matchScore}% match</p>
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
