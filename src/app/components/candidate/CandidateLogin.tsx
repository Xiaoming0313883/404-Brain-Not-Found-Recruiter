import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { Lock, Mail, Upload, ArrowRight, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateData } from '../CandidatePortal';
import { BrandLogo } from '../BrandLogo';
import * as Progress from '@radix-ui/react-progress';

interface Props {
  onAuthenticate: (data: CandidateData) => void;
  forceNewApplication?: boolean;
  initialEmail?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const API_UNREACHABLE_MESSAGE =
  'Cannot reach the API server. Start the FastAPI backend on http://localhost:8000, then try again.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mockJobs = [
  { id: 1, title: 'Senior Full-Stack Engineer', department: 'Engineering' },
  { id: 2, title: 'Product Designer', department: 'Design' },
  { id: 3, title: 'Data Scientist', department: 'Analytics' },
  { id: 4, title: 'DevOps Engineer', department: 'Infrastructure' }
];

export function CandidateLogin({ onAuthenticate, forceNewApplication = false, initialEmail = '' }: Props) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(initialEmail);
  const [lookupComplete, setLookupComplete] = useState(forceNewApplication);
  const [candidateType, setCandidateType] = useState<'invited' | 'inbound' | 'account' | null>(forceNewApplication ? 'inbound' : null);
  const [fullName, setFullName] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingVerification, setPendingVerification] = useState<CandidateData | null>(null);
  const [emailVerificationMode, setEmailVerificationMode] = useState<'new' | 'existing' | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [prototypeVerificationCode, setPrototypeVerificationCode] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [verificationCooldown, setVerificationCooldown] = useState(0);
  const [emailVerifiedForSignup, setEmailVerifiedForSignup] = useState(forceNewApplication);
  
  // Real active jobs fetched from backend
  const [jobs, setJobs] = useState<any[]>(mockJobs);
  const [loadedCandidate, setLoadedCandidate] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch active jobs from backend on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/jobs`)
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        if (data && data.length > 0) {
          setJobs(data);
        }
      })
      .catch(() => {
        console.log("Using local mock jobs list.");
      });
  }, []);

  useEffect(() => {
    if (forceNewApplication) {
      setEmail(initialEmail);
      setCandidateType('inbound');
      setLookupComplete(true);
      setEmailVerifiedForSignup(true);
    }
  }, [forceNewApplication, initialEmail]);

  useEffect(() => {
    if (!verificationCooldown) return;
    const timer = window.setInterval(() => {
      setVerificationCooldown(current => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verificationCooldown]);

  useEffect(() => {
    if (errorMessage) toast.error(errorMessage);
  }, [errorMessage]);

  const mapCandidateFromApi = (data: any): CandidateData => {
    const normalizeStatus = (statusValue: string): CandidateData['status'] =>
      statusValue === 'invited' || statusValue === 'staged'
        ? 'invited'
        : statusValue === 'completed'
          ? 'completed'
          : statusValue === 'hired'
            ? 'hired'
            : statusValue === 'screening'
              ? 'screening'
              : statusValue === 'rejected'
                ? 'rejected'
                : statusValue === 'interview_scheduled'
                  ? 'interview_scheduled'
                  : statusValue === 'profile'
                    ? 'profile'
                    : statusValue === 'applied'
                      ? 'applied'
                      : 'invited';
    const applications = (data.applications || []).map((application: any) => ({
      ...application,
      status: normalizeStatus(application.status),
      progress: application.progress ?? (
        normalizeStatus(application.status) === 'completed' ? 100 :
        normalizeStatus(application.status) === 'hired' ? 100 :
        normalizeStatus(application.status) === 'rejected' ? 100 :
        normalizeStatus(application.status) === 'interview_scheduled' ? 85 :
        normalizeStatus(application.status) === 'screening' ? 70 : 40
      )
    }));
    const selectedApplication = applications.find((application: any) => application.position_id === data.position_id) || applications[applications.length - 1];
    const matchedJob = jobs.find(j => j.id === (selectedApplication?.position_id || data.position_id));
    const status = normalizeStatus(selectedApplication?.status || data.status);

    return {
      email: data.email,
      name: data.name,
      jobId: selectedApplication?.position_id || data.position_id,
      selectedApplicationId: selectedApplication?.application_id,
      applications,
      position: matchedJob ? matchedJob.title : 'Senior Full-Stack Engineer',
      status,
      progress: selectedApplication?.progress ?? (
        status === 'completed' ? 100 :
        status === 'hired' ? 100 :
        status === 'rejected' ? 100 :
        status === 'interview_scheduled' ? 85 :
        status === 'screening' ? 70 :
        status === 'sourced' ? 50 :
        status === 'profile' ? 10 : 40
      ),
      isInvited: Boolean(data.is_sourced),
      appliedAt: selectedApplication?.applied_at || data.applied_at,
      profilePictureUrl: data.profile_picture_url,
      resumeUrl: data.resume_url,
      resumeSummary: data.resume_summary,
      profileExtractionWarning: data.profile_data?.extraction_warning || '',
      profileMissingFields: data.profile_missing_fields || [],
      profileCompletion: data.profile_completion ?? 0,
      emailVerified: data.email_verified,
      profileVerified: data.profile_verified,
      age: data.profile_data?.age || '',
      address: data.profile_data?.address || '',
      cameFrom: data.profile_data?.came_from || '',
      location: data.profile_data?.location || '',
      headline: data.profile_data?.headline || '',
      about: data.profile_data?.about || '',
      workExperience: data.profile_data?.work_experience || '',
      qualification: data.profile_data?.qualification || '',
      gradeResults: data.profile_data?.grade_results || '',
      awards: data.profile_data?.awards || [],
      phone: data.profile_data?.phone || '',
      skills: data.profile_data?.skills || [],
      experiences: data.profile_data?.experiences || [],
      education: data.profile_data?.education || [],
      recruitmentEmail: data.outreach_email,
      customQuestions: selectedApplication?.custom_questions || data.custom_questions,
      sandboxAnswers: selectedApplication?.answers?.length ? selectedApplication.answers : (selectedApplication?.draft_answers || data.answers),
      score: (selectedApplication?.evaluation || data.evaluation)?.screening_score,
      evaluation: selectedApplication?.evaluation || data.evaluation,
      hrFeedback: selectedApplication?.hr_feedback || data.hr_feedback || '',
      rejectionMessage: selectedApplication?.rejection_message || data.rejection_message || '',
      rejectedAt: selectedApplication?.rejected_at || data.rejected_at,
      hiredAt: selectedApplication?.hired_at || data.hired_at,
      interviewSlot: selectedApplication?.interview_slot || data.interview_slot,
      agentWarnings: data.agent_warnings || selectedApplication?.agent_warnings || [],
      notifications: data.notifications || [],
      sourceType: data.source_type,
      sourceMethod: data.source_method,
      lastAgentError: selectedApplication?.last_agent_error || data.last_agent_error || ''
    };
  };

  const validatePassword = () => {
    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return false;
    }
    if (!loadedCandidate?.has_password && password !== confirmPassword) {
      setErrorMessage('Password confirmation does not match.');
      return false;
    }
    return true;
  };

  const validateEmailInput = () => {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setErrorMessage('Please enter a valid email address.');
      return false;
    }
    return true;
  };

  const setExistingCandidatePassword = async () => {
    if (!loadedCandidate || !validatePassword()) return null;
    const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(loadedCandidate.management_email || loadedCandidate.email)}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to set password.');
    }
    return response.json();
  };

  const loginExistingCandidate = async () => {
    if (!loadedCandidate || !validatePassword()) return null;
    const response = await fetch(`${API_BASE_URL}/candidates/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loadedCandidate.management_email || loadedCandidate.email,
        password
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to log in.');
    }
    return response.json();
  };

  const uploadResume = (formData: FormData) => {
    return new Promise<any>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${API_BASE_URL}/candidates/signup`);

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const uploadPercent = Math.round((event.loaded / event.total) * 55);
          setUploadProgress(Math.max(5, uploadPercent));
          setProcessingMessage('Uploading resume...');
        }
      };

      request.onload = () => {
        let payload: any = null;
        try {
          payload = request.responseText ? JSON.parse(request.responseText) : null;
        } catch {
          payload = null;
        }

        if (request.status >= 200 && request.status < 300) {
          setUploadProgress(100);
          setProcessingMessage('Interview session ready.');
          resolve(payload);
          return;
        }

        reject(new Error(payload?.detail || `Failed to save your profile. API returned ${request.status}.`));
      };

      request.onerror = () => reject(new TypeError(API_UNREACHABLE_MESSAGE));
      request.ontimeout = () => reject(new Error('Resume upload timed out. Please try again.'));
      request.timeout = 90000;

      setUploadProgress(5);
      setProcessingMessage('Starting upload...');
      request.send(formData);

      window.setTimeout(() => {
        setUploadProgress(current => Math.max(current, 65));
        setProcessingMessage('Reading PDF and standardizing your profile...');
      }, 900);
      window.setTimeout(() => {
        setUploadProgress(current => Math.max(current, 78));
        setProcessingMessage('Matching your profile to the selected role...');
      }, 2500);
      window.setTimeout(() => {
        setUploadProgress(current => Math.max(current, 90));
        setProcessingMessage('Generating your interview questions...');
      }, 5000);
    });
  };

  const startEmailVerification = async (targetEmail: string) => {
    const response = await fetch(`${API_BASE_URL}/candidates/start-email-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Unable to start email verification.');
    }
    setPrototypeVerificationCode(data.prototype_verification_code || '');
    setVerificationCooldown(data.cooldown_seconds || 0);
    if (data.cooldown_seconds && !data.verification_sent) {
      setVerificationMessage(`Please wait ${data.cooldown_seconds} seconds before resending the verification email.`);
      toast.warning(`Please wait ${data.cooldown_seconds} seconds before resending.`);
    } else if (data.verification_sent) {
      setVerificationMessage(`A verification email was sent to ${targetEmail}.`);
      toast.success(`Verification email sent to ${targetEmail}.`);
    } else {
      setVerificationMessage('Prototype mode: SMTP is not configured, so use the demo code below.');
      toast.info('Prototype mode: use the demo verification code shown below.');
    }
    return data;
  };

  const handleEmailLookup = async () => {
    setErrorMessage('');
    setPassword('');
    setConfirmPassword('');
    setVerificationCode('');
    setPrototypeVerificationCode('');
    setEmailVerificationMode(null);
    setEmailVerifiedForSignup(false);
    if (!validateEmailInput()) return;
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/lookup?email=${encodeURIComponent(email.trim())}`);
      if (response.ok) {
        const data = await response.json();
        setLoadedCandidate(data);
        setCandidateType(data.status === 'invited' || data.is_sourced ? 'invited' : 'account');
        if (data.email_verified === false) {
          await startEmailVerification(data.management_email || data.email);
          setEmailVerificationMode('existing');
          setLookupComplete(false);
        } else {
          setLookupComplete(true);
        }
      } else if (response.status === 404) {
        await startEmailVerification(email.trim());
        setCandidateType('inbound');
        setEmailVerificationMode('new');
        setLookupComplete(false);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Unable to look up this email.');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || API_UNREACHABLE_MESSAGE);
    }
  };

  const handleInboundSubmit = async () => {
    if (!fullName.trim() || !resume) return;
    if (!validateEmailInput()) return;
    if (!emailVerifiedForSignup) {
      setErrorMessage('Verify your email address before creating your candidate profile.');
      return;
    }
    if (!validatePassword()) return;
    if (resume.size > MAX_RESUME_BYTES) {
      setErrorMessage('Resume must be 10MB or smaller.');
      return;
    }
    if (!resume.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Please upload a PDF resume.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setUploadProgress(0);
    setProcessingMessage('');

    try {
      const formData = new FormData();
      formData.append('name', fullName.trim());
      formData.append('email', email.trim());
      formData.append('password', password);
      formData.append('resume', resume);

      const data = await uploadResume(formData);
      
      const mappedData: CandidateData = {
        email: data.email,
        name: data.name,
        jobId: data.position_id,
        position: '',
        status: 'profile',
        progress: 10,
        isInvited: false,
        resumeData: { filename: resume.name },
        profilePictureUrl: data.profile_picture_url,
        resumeUrl: data.resume_url,
        resumeSummary: data.resume_summary,
        profileExtractionWarning: data.profile_data?.extraction_warning || '',
        profileMissingFields: data.profile_missing_fields || [],
        profileCompletion: data.profile_completion ?? 0,
        emailVerified: data.email_verified,
        profileVerified: data.profile_verified,
        age: data.profile_data?.age || '',
        address: data.profile_data?.address || '',
        cameFrom: data.profile_data?.came_from || '',
        location: data.profile_data?.location || '',
        headline: data.profile_data?.headline || '',
        about: data.profile_data?.about || '',
        workExperience: data.profile_data?.work_experience || '',
        qualification: data.profile_data?.qualification || '',
        gradeResults: data.profile_data?.grade_results || '',
        awards: data.profile_data?.awards || [],
        phone: data.profile_data?.phone || '',
        skills: data.profile_data?.skills || [],
        experiences: data.profile_data?.experiences || [],
        education: data.profile_data?.education || [],
        applications: data.applications || [],
        customQuestions: data.custom_questions,
        evaluation: data.evaluation,
        agentWarnings: data.agent_warnings || [],
        notifications: data.notifications || [],
        sourceType: data.source_type,
        sourceMethod: data.source_method
      };

      if (!data.email_verified) {
        setPendingVerification(mappedData);
        setPrototypeVerificationCode(data.prototype_verification_code || '');
        setVerificationCooldown(data.cooldown_seconds || 0);
        setVerificationMessage(data.verification_sent
          ? `A verification email was sent to ${data.email}.`
          : 'Prototype mode: SMTP is not configured, so use the demo code below.');
        toast.info(data.verification_sent ? 'Please verify your email before continuing.' : 'Prototype mode: use the demo verification code shown below.');
        setIsSubmitting(false);
        setUploadProgress(0);
        setProcessingMessage('');
        return;
      }

      onAuthenticate(mappedData);
      toast.success('Candidate profile created.');
      navigate('/candidate/home');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err instanceof TypeError ? API_UNREACHABLE_MESSAGE : err.message || 'Connection error with API server.');
      setIsSubmitting(false);
      setUploadProgress(0);
      setProcessingMessage('');
    }
  };

  const handleVerifyEmail = async () => {
    if (!pendingVerification && !emailVerificationMode) return;
    if (!verificationCode.trim()) {
      setErrorMessage('Enter the verification code from your email.');
      return;
    }
    setIsVerifyingEmail(true);
    setErrorMessage('');
    try {
      if (emailVerificationMode) {
        const response = await fetch(`${API_BASE_URL}/candidates/verify-pending-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), code: verificationCode.trim() })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Invalid verification code.');
        }
        const data = await response.json();
        setPrototypeVerificationCode('');
        setVerificationMessage('');
        setVerificationCode('');
        const mode = emailVerificationMode;
        setEmailVerificationMode(null);
        if (mode === 'existing') {
          setLoadedCandidate(data);
          setCandidateType(data.status === 'invited' || data.is_sourced ? 'invited' : 'account');
          setLookupComplete(true);
        } else {
          setEmailVerifiedForSignup(true);
          setCandidateType('inbound');
          setLookupComplete(true);
        }
        toast.success('Email verified.');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(pendingVerification!.email)}/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode.trim() })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Invalid verification code.');
      }
      const data = await response.json();
      const verifiedCandidate = {
        ...pendingVerification!,
        emailVerified: data.email_verified,
        profileVerified: data.profile_verified,
      };
      onAuthenticate(verifiedCandidate);
      toast.success('Email verified.');
      navigate('/candidate/home');
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to verify email.');
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  const handleResendVerification = async () => {
    if (!pendingVerification && !emailVerificationMode) return;
    setErrorMessage('');
    if (verificationCooldown > 0) {
      setVerificationMessage(`Please wait ${verificationCooldown} seconds before resending the verification email.`);
      toast.warning(`Please wait ${verificationCooldown} seconds before resending.`);
      return;
    }
    setIsResendingVerification(true);
    try {
      if (emailVerificationMode) {
        await startEmailVerification(email.trim());
        return;
      }
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(pendingVerification!.email)}/resend-verification`, {
        method: 'POST'
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Unable to resend verification email.');
      }
      setPrototypeVerificationCode(data.prototype_verification_code || '');
      setVerificationCooldown(data.cooldown_seconds || 0);
      if (data.cooldown_seconds && !data.verification_sent) {
        setVerificationMessage(`Please wait ${data.cooldown_seconds} seconds before resending the verification email.`);
        toast.warning(`Please wait ${data.cooldown_seconds} seconds before resending.`);
      } else if (data.verification_sent) {
        setVerificationMessage(`A new verification email was sent to ${pendingVerification!.email}.`);
        toast.success('Verification email resent.');
      } else {
        setVerificationMessage('Prototype mode: SMTP is not configured, so use the new demo code below.');
        toast.info('Prototype mode: use the new demo verification code shown below.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to resend verification email.');
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleInvitedContinue = () => {
    if (!loadedCandidate) return;
    setErrorMessage('');

    const authenticate = async () => {
      try {
        const data = loadedCandidate.has_password
          ? await loginExistingCandidate()
          : await setExistingCandidatePassword();
        if (!data) return;
        const candidateData = mapCandidateFromApi(data);
        if (data.email_verified === false) {
          setPendingVerification(candidateData);
          setVerificationMessage(`Enter the verification code sent to ${candidateData.email}.`);
          return;
        }
        onAuthenticate(candidateData);
        navigate('/candidate/sandbox');
      } catch (err: any) {
        setErrorMessage(err.message || 'Unable to authenticate candidate.');
      }
    };

    authenticate();
  };

  const handleAccountContinue = () => {
    if (!loadedCandidate) return;
    setErrorMessage('');

    const authenticate = async () => {
      try {
        const data = loadedCandidate.has_password
          ? await loginExistingCandidate()
          : await setExistingCandidatePassword();
        if (!data) return;
        const candidateData = mapCandidateFromApi(data);
        if (data.email_verified === false) {
          setPendingVerification(candidateData);
          setVerificationMessage(`Enter the verification code sent to ${candidateData.email}.`);
          return;
        }
        onAuthenticate(candidateData);
        navigate('/candidate/home');
      } catch (err: any) {
        setErrorMessage(err.message || 'Unable to authenticate candidate.');
      }
    };

    authenticate();
  };
  const getAccountProgressInfo = (cand: any) => {
    const status = cand.status;
    const apps = cand.applications || [];
    const latestApp = apps.length > 0 ? apps[apps.length - 1] : null;
    const activeStatus = latestApp ? latestApp.status : status;
    const hasAnswers = Boolean(latestApp?.answers?.length || cand.answers?.length);

    if (activeStatus === 'hired') {
      return { percent: 100, label: 'Hired' };
    }
    if (activeStatus === 'rejected') {
      return { percent: 100, label: 'Rejected' };
    }
    if (activeStatus === 'interview_scheduled') {
      return { percent: 80, label: 'Interview In Progress' };
    }
    if (activeStatus === 'completed') {
      return { percent: 60, label: 'Waiting for Interview' };
    }
    if (activeStatus === 'screening' || hasAnswers) {
      return { percent: 40, label: 'Screening Completed' };
    }
    
    return { percent: 20, label: 'Waiting for Screening' };
  };
  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-[#e4e1da] rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20 transition-colors";
  const needsPasswordSetup = !loadedCandidate?.has_password;
  const passwordFields = (
    <div className="space-y-3">
      <div>
        <label className="block mb-1.5 text-sm text-[#1c1c1a]">
          {needsPasswordSetup ? 'Create Password *' : 'Password *'}
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a49d]" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            className={`${inputClass} pl-10`}
          />
        </div>
      </div>
      {needsPasswordSetup && (
        <div>
          <label className="block mb-1.5 text-sm text-[#1c1c1a]">Confirm Password *</label>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a49d]" />
          <input
            type="password"
            value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (password && e.target.value && password !== e.target.value) {
                  setErrorMessage('Password confirmation does not match.');
                } else if (errorMessage === 'Password confirmation does not match.') {
                  setErrorMessage('');
                }
              }}
              placeholder="Re-enter password"
              className={`${inputClass} pl-10`}
            />
          </div>
        </div>
      )}
    </div>
  );
  const verificationEmail = pendingVerification?.email || email.trim();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f7f6f3]">
      <div className="absolute top-6 left-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          All Portals
        </Link>
      </div>

      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <BrandLogo className="justify-center mb-5" imageClassName="h-20" />
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4">Candidate Portal</p>
          <h1 className="text-[#1c1c1a] mb-3">Sign In to 404Hire</h1>
          <p className="text-sm text-[#6b7063]">
            Log in with your email, configure your profile, then start your personalized interview session.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
            {errorMessage}
          </div>
        )}

        {(pendingVerification || emailVerificationMode) && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#e8f2ee] flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-[#2d6a55]" />
              </div>
              <div>
                <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-1 font-semibold">Email Verification</p>
                <h2 className="text-[#1c1c1a] mb-1 font-semibold text-lg">Verify your email address</h2>
                <p className="text-sm text-[#6b7063] leading-relaxed">
                  {verificationMessage || `Enter the verification code sent to ${verificationEmail}.`}
                </p>
              </div>
            </div>

            {prototypeVerificationCode && (
              <div className="rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a14]">
                Prototype demo code: <span className="font-semibold tracking-widest">{prototypeVerificationCode}</span>
              </div>
            )}

            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Verification Code *</label>
              <input
                type="text"
                inputMode="numeric"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="Enter 6-digit code"
                className={inputClass}
              />
            </div>

            <button
              onClick={handleVerifyEmail}
              disabled={isVerifyingEmail || !verificationCode.trim()}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
            >
              {isVerifyingEmail ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  Verify Email
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              onClick={handleResendVerification}
              disabled={verificationCooldown > 0 || isResendingVerification}
              className="w-full py-2 text-sm text-[#2d6a55] hover:text-[#245747] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors"
            >
              {isResendingVerification
                ? 'Resending...'
                : verificationCooldown > 0
                  ? `Resend in ${verificationCooldown}s`
                  : 'Resend verification email'}
            </button>
          </div>
        )}

        {/* Email Lookup */}
        {!pendingVerification && !emailVerificationMode && !lookupComplete && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm">
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
                disabled={!email.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors text-sm whitespace-nowrap"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-[#a8a49d] text-center">
              Use your registered email, or enter a new email to create a candidate account.
            </p>
          </div>
        )}

        {/* Invited Candidate */}
        {!pendingVerification && !emailVerificationMode && lookupComplete && candidateType === 'invited' && loadedCandidate && (
          <div className="space-y-4">
            {/* Welcome */}
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-[#2d6a55] text-lg font-medium">
                    {loadedCandidate.name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-1 font-semibold">Hand-Selected</p>
                  <h2 className="text-[#1c1c1a] mb-1 text-lg font-semibold">
                    Welcome, {loadedCandidate.name}
                  </h2>
                  <p className="text-sm text-[#6b7063] leading-relaxed">
                    You've been invited for the{' '}
                    <span className="text-[#1c1c1a] font-medium">
                      {jobs.find(j => j.id === loadedCandidate.position_id)?.title || 'Senior Full-Stack Engineer'}
                    </span>{' '}
                    role based on your LinkedIn profile.
                  </p>
                </div>
              </div>
            </div>

            {/* Progress */}
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[#6b7063]">Application Progress</span>
                <span className="text-sm text-[#2d6a55] font-medium">50% - Sourced & Invited</span>
              </div>
              <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-1.5 w-full">
                <Progress.Indicator
                  className="bg-[#2d6a55] h-full transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-50%)`, width: '100%' }}
                />
              </Progress.Root>
              <p className="mt-3 text-xs text-[#a8a49d]">Resume upload not required - profile already on file</p>
            </div>

            {/* Recruitment Email */}
            <div className="bg-white border border-[#e4e1da] rounded-2xl overflow-hidden shadow-sm">
              <button
                onClick={() => setEmailOpen(!emailOpen)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#f7f6f3] transition-colors text-left font-medium text-sm text-[#1c1c1a]"
              >
                <span>Your Personalized Recruitment Email</span>
                <span className={`text-xs text-[#a8a49d] transition-transform duration-200 inline-block ${emailOpen ? 'rotate-180' : ''}`}>
                  ▾
                </span>
              </button>
              {emailOpen && (
                <div className="px-6 pb-6 border-t border-[#e4e1da]">
                  <div className="mt-4 bg-[#f7f6f3] rounded-xl p-4">
                    <pre className="whitespace-pre-wrap text-xs text-[#6b7063] leading-relaxed font-sans">
                      {loadedCandidate.outreach_email}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {passwordFields}

            {/* Continue */}
            <button
              onClick={handleInvitedContinue}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
            >
              Start Interview Session
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Returning Candidate Account */}
        {!pendingVerification && !emailVerificationMode && lookupComplete && candidateType === 'account' && loadedCandidate && (
          <div className="space-y-4">
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-[#2d6a55] text-lg font-medium">
                    {loadedCandidate.name.charAt(0)}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-xs tracking-wider uppercase text-[#2d6a55] mb-1 font-semibold">Account Found</p>
                  <h2 className="text-[#1c1c1a] mb-1 text-lg font-semibold">
                    Welcome back, {loadedCandidate.name}
                  </h2>
                  <p className="text-sm text-[#6b7063] leading-relaxed">
                    Review your progress, continue your current interview, or start a future interview session.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[#6b7063]">Application Progress</span>
                <span className="text-sm text-[#2d6a55] font-medium">
                  {getAccountProgressInfo(loadedCandidate).label}
                </span>
              </div>
              <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-1.5 w-full">
                <Progress.Indicator
                  className="bg-[#2d6a55] h-full transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - getAccountProgressInfo(loadedCandidate).percent}%)`, width: '100%' }}
                />
              </Progress.Root>
            </div>

            {passwordFields}

            <button
              onClick={handleAccountContinue}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
            >
              Open Candidate Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Inbound Applicant */}
        {!pendingVerification && !emailVerificationMode && lookupComplete && candidateType === 'inbound' && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5 shadow-sm">
          <div>
            <h2 className="text-[#1c1c1a] mb-1 font-semibold text-lg">Create Your Candidate Profile</h2>
            <p className="text-sm text-[#6b7063]">Upload your resume and set up your account. You can choose positions after login.</p>
          </div>

            {emailVerifiedForSignup && (
              <div className="rounded-xl border border-[#c8e6d8] bg-[#e8f2ee] px-4 py-3 text-sm text-[#2d6a55] font-semibold">
                Email verified for {email.trim()}.
              </div>
            )}

            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className={inputClass}
              />
            </div>

            {passwordFields}

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
                      <span className="text-[#2d6a55] font-medium">{resume.name}</span>
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
              disabled={!fullName.trim() || !resume || isSubmitting}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm font-medium shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing interview session...
                </>
              ) : (
                <>
                  Create Profile
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {isSubmitting && (
              <div className="bg-[#f0ede8] border border-[#e4e1da] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[#a8a49d] font-semibold uppercase tracking-wider">Upload Progress</p>
                  <span className="text-xs text-[#2d6a55] font-semibold">{uploadProgress}%</span>
                </div>
                <Progress.Root className="relative overflow-hidden bg-white rounded-full h-2 w-full mb-3">
                  <Progress.Indicator
                    className="bg-[#2d6a55] h-full transition-transform duration-500 ease-out"
                    style={{ transform: `translateX(-${100 - uploadProgress}%)`, width: '100%' }}
                  />
                </Progress.Root>
                <p className="text-xs text-[#6b7063] mb-3">{processingMessage}</p>
                <p className="text-xs text-[#a8a49d] font-semibold uppercase tracking-wider mb-2">AI Processing Pipeline</p>
                <ul className="text-xs text-[#6b7063] space-y-1.5 list-disc list-inside">
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
