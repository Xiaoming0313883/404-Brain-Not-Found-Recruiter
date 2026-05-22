import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Mail, Upload, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';
import { CandidateData } from '../CandidatePortal';
import * as Progress from '@radix-ui/react-progress';

interface Props {
  onAuthenticate: (data: CandidateData) => void;
}

const mockCandidates = {
  'sarah.chen@email.com': {
    name: 'Sarah Chen',
    position: 'Senior Full-Stack Engineer',
    isInvited: true,
    status: 'sourced' as const,
    progress: 50,
    recruitmentEmail: `Dear Sarah,\n\nWe've been following your impressive career trajectory at leading tech companies, and your LinkedIn profile caught our attention. Your experience in building scalable distributed systems and contributions to open-source projects demonstrate exactly the kind of technical excellence we're looking for.\n\nWe'd love to invite you to explore our Senior Full-Stack Engineer position. Instead of a traditional application process, we've prepared a personalized technical warm-up that matches your skill level.\n\nBest regards,\nThe Hiring Team`
  }
};

const mockJobs = [
  { id: 1, title: 'Senior Full-Stack Engineer', department: 'Engineering' },
  { id: 2, title: 'Product Designer', department: 'Design' },
  { id: 3, title: 'Data Scientist', department: 'Analytics' },
  { id: 4, title: 'DevOps Engineer', department: 'Infrastructure' }
];

export function CandidateLogin({ onAuthenticate }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [lookupComplete, setLookupComplete] = useState(false);
  const [candidateType, setCandidateType] = useState<'invited' | 'inbound' | null>(null);
  const [selectedJob, setSelectedJob] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const handleEmailLookup = () => {
    const candidate = mockCandidates[email as keyof typeof mockCandidates];
    setCandidateType(candidate ? 'invited' : 'inbound');
    setLookupComplete(true);
  };

  const handleInboundSubmit = async () => {
    if (!selectedJob || !resume) return;
    setIsSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 2000));

    const candidateData: CandidateData = {
      email,
      name: email.split('@')[0].replace('.', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      position: mockJobs.find(j => j.id.toString() === selectedJob)?.title || '',
      status: 'applied',
      progress: 33,
      isInvited: false,
      resumeData: { filename: resume.name }
    };
    onAuthenticate(candidateData);
    navigate('/candidate/sandbox');
  };

  const handleInvitedContinue = () => {
    const candidate = mockCandidates[email as keyof typeof mockCandidates];
    const candidateData: CandidateData = {
      email,
      name: candidate.name,
      position: candidate.position,
      status: candidate.status,
      progress: candidate.progress,
      isInvited: candidate.isInvited,
      recruitmentEmail: candidate.recruitmentEmail
    };
    onAuthenticate(candidateData);
    navigate('/candidate/sandbox');
  };

  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-[#e4e1da] rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20 transition-colors";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="absolute top-6 left-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          All Portals
        </Link>
      </div>

      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4">Candidate Portal</p>
          <h1 className="text-[#1c1c1a] mb-3">Your Screening Experience</h1>
          <p className="text-sm text-[#6b7063]">
            A personalized, skills-first assessment designed around your profile.
          </p>
        </div>

        {/* Email Lookup */}
        {!lookupComplete && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8">
            <label className="block mb-1.5 text-sm text-[#1c1c1a]">Email Address</label>
            <div className="flex gap-2.5">
              <div className="flex-1 relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a49d]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className={`${inputClass} pl-10`}
                  onKeyPress={(e) => e.key === 'Enter' && email && handleEmailLookup()}
                />
              </div>
              <button
                onClick={handleEmailLookup}
                disabled={!email}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors text-sm whitespace-nowrap"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-[#a8a49d] text-center">
              Try sarah.chen@email.com (invited) or any other email (inbound)
            </p>
          </div>
        )}

        {/* Invited Candidate */}
        {lookupComplete && candidateType === 'invited' && (
          <div className="space-y-4">
            {/* Welcome */}
            <div className="bg-white border border-[#2d6a55]/20 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-[#2d6a55] text-lg">
                    {mockCandidates[email as keyof typeof mockCandidates]?.name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-1">Hand-Selected</p>
                  <h2 className="text-[#1c1c1a] mb-1">
                    Welcome, {mockCandidates[email as keyof typeof mockCandidates].name}
                  </h2>
                  <p className="text-sm text-[#6b7063] leading-relaxed">
                    You've been invited for the{' '}
                    <span className="text-[#1c1c1a]">
                      {mockCandidates[email as keyof typeof mockCandidates].position}
                    </span>{' '}
                    role based on your LinkedIn profile.
                  </p>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[#6b7063]">Application Progress</span>
                <span className="text-sm text-[#2d6a55]">50% — Sourced & Invited</span>
              </div>
              <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-1.5">
                <Progress.Indicator
                  className="bg-[#2d6a55] h-full transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-50%)` }}
                />
              </Progress.Root>
              <p className="mt-3 text-xs text-[#a8a49d]">Resume upload not required — profile already on file</p>
            </div>

            {/* Recruitment Email */}
            <div className="bg-white border border-[#e4e1da] rounded-2xl overflow-hidden">
              <button
                onClick={() => setEmailOpen(!emailOpen)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#f7f6f3] transition-colors text-left"
              >
                <span className="text-sm text-[#1c1c1a]">Your Personalized Recruitment Email</span>
                <span className={`text-xs text-[#a8a49d] transition-transform duration-200 inline-block ${emailOpen ? 'rotate-180' : ''}`}>
                  ▾
                </span>
              </button>
              {emailOpen && (
                <div className="px-6 pb-6 border-t border-[#e4e1da]">
                  <div className="mt-4 bg-[#f7f6f3] rounded-xl p-4">
                    <pre className="whitespace-pre-wrap text-xs text-[#6b7063] leading-relaxed font-sans">
                      {mockCandidates[email as keyof typeof mockCandidates].recruitmentEmail}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Continue */}
            <button
              onClick={handleInvitedContinue}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors flex items-center justify-center gap-2 text-sm"
            >
              Continue to Interactive Sandbox
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Inbound Applicant */}
        {lookupComplete && candidateType === 'inbound' && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5">
            <div>
              <h2 className="text-[#1c1c1a] mb-1">Submit Your Application</h2>
              <p className="text-sm text-[#6b7063]">Complete the form below to begin your screening process</p>
            </div>

            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Select Role *</label>
              <select
                value={selectedJob}
                onChange={(e) => setSelectedJob(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose a position...</option>
                {mockJobs.map(job => (
                  <option key={job.id} value={job.id}>
                    {job.title} — {job.department}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Upload Resume (PDF) *</label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setResume(e.target.files?.[0] || null)}
                className="hidden"
                id="resume-upload"
              />
              <label
                htmlFor="resume-upload"
                className={`flex items-center justify-center w-full py-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  resume
                    ? 'border-[#2d6a55]/40 bg-[#f0f9f4]'
                    : 'border-[#e4e1da] hover:border-[#2d6a55]/30 hover:bg-[#f7f6f3]'
                }`}
              >
                <div className="text-center">
                  <Upload className={`w-6 h-6 mx-auto mb-2 ${resume ? 'text-[#2d6a55]' : 'text-[#a8a49d]'}`} />
                  <p className="text-sm text-[#6b7063]">
                    {resume ? (
                      <span className="text-[#2d6a55]">{resume.name}</span>
                    ) : (
                      'Click to upload or drag and drop'
                    )}
                  </p>
                  <p className="text-xs text-[#a8a49d] mt-1">PDF up to 10MB</p>
                </div>
              </label>
            </div>

            <button
              onClick={handleInboundSubmit}
              disabled={!selectedJob || !resume || isSubmitting}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing application...
                </>
              ) : (
                <>
                  Submit Application
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {isSubmitting && (
              <div className="bg-[#f0ede8] border border-[#e4e1da] rounded-xl p-4">
                <p className="text-xs text-[#a8a49d] uppercase tracking-wider mb-2">AI Processing Pipeline</p>
                <ul className="text-xs text-[#6b7063] space-y-1">
                  <li>Resume Agent: Standardizing profile data...</li>
                  <li>Matching Agent: Running debate analysis...</li>
                  <li>Interview Agent: Generating personalized questions...</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
