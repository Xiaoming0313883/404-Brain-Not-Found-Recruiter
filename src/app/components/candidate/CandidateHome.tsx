import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Progress from '@radix-ui/react-progress';
import { ArrowLeft, BarChart3, Briefcase, FileText, Loader2, LogOut, MessageSquare, PlayCircle, Users, Save } from 'lucide-react';
import { CandidateData } from '../CandidatePortal';

interface Props {
  candidateData: CandidateData;
  onUpdateCandidate: (data: CandidateData) => void;
  onSignOut: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

const formatDateTime = (value?: string) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const statusLabels: Record<CandidateData['status'], string> = {
  profile: 'Profile Ready',
  sourced: 'Sourced & Invited',
  applied: 'Position Applied',
  screening: 'Interview In Progress',
  completed: 'Screening Completed'
};

const normalizeApplicationStatus = (status: string): CandidateData['status'] =>
  status === 'invited' || status === 'staged'
    ? 'sourced'
    : status === 'completed'
      ? 'completed'
      : status === 'screening'
        ? 'screening'
        : status === 'profile'
          ? 'profile'
          : 'applied';

export function CandidateHome({ candidateData, onUpdateCandidate, onSignOut }: Props) {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<any[]>([]);
  const [allPositions, setAllPositions] = useState<any[]>([]);
  const [isApplying, setIsApplying] = useState<number | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [profileForm, setProfileForm] = useState({
    name: candidateData.name || '',
    age: candidateData.age || '',
    phone: candidateData.phone || '',
    address: candidateData.address || '',
    cameFrom: candidateData.cameFrom || '',
    location: candidateData.location || '',
    headline: candidateData.headline || '',
    workExperience: candidateData.workExperience || '',
    qualification: candidateData.qualification || '',
    gradeResults: candidateData.gradeResults || '',
    awards: (candidateData.awards || []).join(', '),
    skills: (candidateData.skills || []).join(', ')
  });
  const applications = candidateData.applications || [];
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    candidateData.selectedApplicationId || applications[applications.length - 1]?.application_id || ''
  );
  const selectedApplication = applications.find(application => application.application_id === selectedApplicationId)
    || applications.find(application => application.position_id === candidateData.jobId)
    || applications[applications.length - 1];
  const selectedPositionId = selectedApplication?.position_id || candidateData.jobId;
  const selectedPosition = allPositions.find(position => position.id === selectedPositionId);
  const selectedStatus = normalizeApplicationStatus(selectedApplication?.status || candidateData.status);
  const progress = selectedApplication?.progress ?? (selectedStatus === 'completed' ? 100 : selectedStatus === 'screening' ? 70 : selectedStatus === 'profile' ? 10 : 40);
  const selectedEvaluation = selectedApplication?.evaluation || candidateData.evaluation;
  const selectedScore = selectedEvaluation?.screening_score ?? candidateData.score;
  const canReview = selectedStatus === 'completed';
  const canContinue = selectedStatus !== 'completed' && selectedStatus !== 'profile' && Boolean(selectedApplication);
  const appliedPositionIds = new Set(applications.map(application => application.position_id));

  useEffect(() => {
    fetch(`${API_BASE_URL}/jobs`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setAllPositions(data);
        setPositions(data.filter((position: any) => position.is_open_for_applications));
      })
      .catch(() => {
        setAllPositions([]);
        setPositions([]);
      });
  }, []);

  const mapCandidateFromApi = (data: any, positionTitle = ''): CandidateData => {
    const status = data.status === 'completed'
      ? 'completed'
      : data.status === 'screening'
        ? 'screening'
        : data.status === 'invited'
          ? 'sourced'
          : data.status === 'profile'
            ? 'profile'
            : 'applied';

    const normalizedApplications = (data.applications || []).map((application: any) => {
      const applicationStatus = normalizeApplicationStatus(application.status);
      return {
        ...application,
        status: applicationStatus,
        progress: application.progress ?? (applicationStatus === 'completed' ? 100 : applicationStatus === 'screening' ? 70 : 40)
      };
    });

    return {
      email: data.email,
      name: data.name,
      jobId: data.position_id,
      selectedApplicationId: data.application_id,
      applications: normalizedApplications.length ? normalizedApplications : [
        ...(candidateData.applications || []).filter(application => application.position_id !== data.position_id),
        {
          application_id: data.application_id || `position-${data.position_id}`,
          position_id: data.position_id,
          status,
          applied_at: data.applied_at,
          progress: status === 'completed' ? 100 : status === 'screening' ? 70 : 40,
          custom_questions: data.custom_questions,
          answers: data.answers,
          evaluation: data.evaluation,
          match_results: data.match_results
        }
      ],
      position: positionTitle || positions.find(position => position.id === data.position_id)?.title || candidateData.position,
      status,
      progress: status === 'profile' ? 10 : status === 'completed' ? 100 : status === 'screening' ? 66 : status === 'sourced' ? 50 : 33,
      isInvited: Boolean(data.is_sourced),
      appliedAt: data.applied_at,
      profilePictureUrl: data.profile_picture_url || candidateData.profilePictureUrl,
      resumeUrl: data.resume_url || candidateData.resumeUrl,
      resumeSummary: data.resume_summary || candidateData.resumeSummary,
      profileExtractionWarning: data.profile_data?.extraction_warning || candidateData.profileExtractionWarning,
      resumeData: data.resume_filename ? { filename: data.resume_filename } : candidateData.resumeData,
      profileVerified: data.profile_verified ?? candidateData.profileVerified,
      age: data.profile_data?.age || candidateData.age,
      address: data.profile_data?.address || candidateData.address,
      cameFrom: data.profile_data?.came_from || candidateData.cameFrom,
      location: data.profile_data?.location || candidateData.location,
      headline: data.profile_data?.headline || candidateData.headline,
      workExperience: data.profile_data?.work_experience || candidateData.workExperience,
      qualification: data.profile_data?.qualification || candidateData.qualification,
      gradeResults: data.profile_data?.grade_results || candidateData.gradeResults,
      awards: data.profile_data?.awards || candidateData.awards,
      phone: data.profile_data?.phone || candidateData.phone,
      skills: data.profile_data?.skills || candidateData.skills,
      recruitmentEmail: data.outreach_email,
      customQuestions: data.custom_questions,
      sandboxAnswers: data.answers,
      score: data.evaluation?.screening_score,
      evaluation: data.evaluation
    };
  };

  const handleApply = async (position: any) => {
    if (candidateData.emailVerified === false) {
      setErrorMessage('Verify your email address before applying to a position.');
      return;
    }
    if (!candidateData.profileVerified) {
      setErrorMessage('Verify your basic information before applying to a position.');
      return;
    }
    if (appliedPositionIds.has(position.id)) {
      setErrorMessage('You have already applied for this position.');
      return;
    }
    setIsApplying(position.id);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/apply-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_id: position.id })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to apply for position.');
      }
      const data = await response.json();
      const mapped = mapCandidateFromApi(data, position.title);
      onUpdateCandidate(mapped);
      setSelectedApplicationId(mapped.selectedApplicationId || `position-${position.id}`);
      navigate('/candidate/sandbox');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to apply for position.');
    } finally {
      setIsApplying(null);
    }
  };

  const handleProfileFieldChange = (field: keyof typeof profileForm, value: string) => {
    setProfileForm(current => ({ ...current, [field]: value }));
  };

  const profileReady = Boolean(
    profileForm.name.trim() &&
    profileForm.age.trim() &&
    profileForm.address.trim() &&
    profileForm.cameFrom.trim() &&
    profileForm.phone.trim() &&
    profileForm.workExperience.trim() &&
    profileForm.qualification.trim() &&
    profileForm.gradeResults.trim()
  );

  const handleSaveProfile = async () => {
    if (!profileReady) {
      setErrorMessage('Please complete name, age, address, came from, phone number, working experience, qualification, and grade/results before saving.');
      return;
    }
    setIsSavingProfile(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profileForm.name.trim(),
          age: profileForm.age.trim(),
          phone: profileForm.phone.trim(),
          address: profileForm.address.trim(),
          came_from: profileForm.cameFrom.trim(),
          location: profileForm.location.trim(),
          headline: profileForm.headline.trim(),
          work_experience: profileForm.workExperience.trim(),
          qualification: profileForm.qualification.trim(),
          grade_results: profileForm.gradeResults.trim(),
          awards: profileForm.awards.split(',').map(award => award.trim()).filter(Boolean),
          skills: profileForm.skills.split(',').map(skill => skill.trim()).filter(Boolean)
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to save profile details.');
      }
      const data = await response.json();
      onUpdateCandidate({
        ...candidateData,
        name: data.name,
        profileVerified: true,
        profileExtractionWarning: data.profile_data?.extraction_warning || candidateData.profileExtractionWarning,
        age: data.profile_data?.age || profileForm.age,
        address: data.profile_data?.address || profileForm.address,
        cameFrom: data.profile_data?.came_from || profileForm.cameFrom,
        location: data.profile_data?.location || profileForm.location,
        headline: data.profile_data?.headline || profileForm.headline,
        workExperience: data.profile_data?.work_experience || profileForm.workExperience,
        qualification: data.profile_data?.qualification || profileForm.qualification,
        gradeResults: data.profile_data?.grade_results || profileForm.gradeResults,
        awards: data.profile_data?.awards || profileForm.awards.split(',').map(award => award.trim()).filter(Boolean),
        phone: data.profile_data?.phone || profileForm.phone,
        skills: data.profile_data?.skills || profileForm.skills.split(',').map(skill => skill.trim()).filter(Boolean)
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save profile details.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="min-h-screen py-12 px-6 bg-[#f7f6f3]">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors">
            <ArrowLeft className="w-4 h-4" />
            All Portals
          </Link>
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 shadow-sm mb-5">
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-4 font-semibold">Candidate Account</p>
          <div className="flex items-start justify-between gap-5">
            <div>
              <h1 className="text-[#1c1c1a] text-2xl font-semibold mb-1">Welcome back, {candidateData.name}</h1>
              <p className="text-sm text-[#6b7063]">{candidateData.email}</p>
              <p className="text-sm text-[#1c1c1a] mt-3 font-medium">{selectedPosition?.title || candidateData.position || 'Candidate profile ready'}</p>
            </div>
            {candidateData.profilePictureUrl ? (
              <img src={`${API_ORIGIN}${candidateData.profilePictureUrl}`} alt={candidateData.name} className="w-14 h-14 rounded-2xl object-cover border border-[#e4e1da] flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-[#e8f2ee] flex items-center justify-center text-[#2d6a55] text-xl font-semibold flex-shrink-0">
                {candidateData.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {candidateData.emailVerified === false && (
          <div className="mb-5 rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a14]">
            Email verification is required before applying to a position. Sign out and complete the verification step from the Candidate Portal.
          </div>
        )}

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-4 h-4 text-[#2d6a55]" />
            <div>
              <h2 className="text-[#1c1c1a] font-semibold">Information Details</h2>
              <p className="text-xs text-[#6b7063]">Review resume-extracted details and complete any missing basic information.</p>
            </div>
          </div>
          {candidateData.profileExtractionWarning && (
            <div className="mb-4 rounded-xl border border-[#f2d3a4] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a14]">
              {candidateData.profileExtractionWarning}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Full Name *</label>
              <input
                value={profileForm.name}
                onChange={(event) => handleProfileFieldChange('name', event.target.value)}
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Age *</label>
              <input
                value={profileForm.age}
                onChange={(event) => handleProfileFieldChange('age', event.target.value)}
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Phone Number *</label>
              <input
                value={profileForm.phone}
                onChange={(event) => handleProfileFieldChange('phone', event.target.value)}
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Location</label>
              <input
                value={profileForm.location}
                onChange={(event) => handleProfileFieldChange('location', event.target.value)}
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs text-[#a8a49d] mb-1">Came From *</label>
            <input
              value={profileForm.cameFrom}
              onChange={(event) => handleProfileFieldChange('cameFrom', event.target.value)}
              placeholder="Country, city, university, referral source, or previous company"
              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
            />
          </div>
          <div className="mt-4">
            <label className="block text-xs text-[#a8a49d] mb-1">Address *</label>
            <textarea
              value={profileForm.address}
              onChange={(event) => handleProfileFieldChange('address', event.target.value)}
              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
              rows={2}
            />
          </div>
          <div className="mt-4">
            <label className="block text-xs text-[#a8a49d] mb-1">Work Experience *</label>
            <textarea
              value={profileForm.workExperience}
              onChange={(event) => handleProfileFieldChange('workExperience', event.target.value)}
              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55] resize-none"
              rows={3}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Qualification *</label>
              <input
                value={profileForm.qualification}
                onChange={(event) => handleProfileFieldChange('qualification', event.target.value)}
                placeholder="Degree, diploma, certificate, or highest education"
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#a8a49d] mb-1">Grade and Results *</label>
              <input
                value={profileForm.gradeResults}
                onChange={(event) => handleProfileFieldChange('gradeResults', event.target.value)}
                placeholder="CGPA, GPA, class, exam result, or honors"
                className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs text-[#a8a49d] mb-1">Awards</label>
            <input
              value={profileForm.awards}
              onChange={(event) => handleProfileFieldChange('awards', event.target.value)}
              placeholder="Awards, scholarships, competitions, honors"
              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
            />
          </div>
          <div className="mt-4">
            <label className="block text-xs text-[#a8a49d] mb-1">Skills</label>
            <input
              value={profileForm.skills}
              onChange={(event) => handleProfileFieldChange('skills', event.target.value)}
              placeholder="React, Python, SQL"
              className="w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]"
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 pt-4 border-t border-[#e4e1da]">
            <p className={`text-xs font-semibold ${candidateData.profileVerified ? 'text-[#2d6a55]' : 'text-[#c25a2a]'}`}>
              {candidateData.profileVerified ? 'Profile verified' : 'Verification required before applying'}
            </p>
            <button
              onClick={handleSaveProfile}
              disabled={!profileReady || isSavingProfile}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed text-sm font-medium"
            >
              {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Details
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-5 p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
            {errorMessage}
          </div>
        )}

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#6b7063] uppercase tracking-wider font-semibold">Application Progress</span>
            <span className="text-xs text-[#2d6a55] font-semibold">{statusLabels[selectedStatus]}</span>
          </div>
          <Progress.Root className="relative overflow-hidden bg-[#f0ede8] rounded-full h-2 w-full">
            <Progress.Indicator
              className="bg-[#2d6a55] h-full transition-transform duration-500"
              style={{ transform: `translateX(-${100 - progress}%)`, width: '100%' }}
            />
          </Progress.Root>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <FileText className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Profile</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{candidateData.resumeData ? 'Resume Uploaded' : 'Profile On File'}</p>
            </div>
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <PlayCircle className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Interview</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{canContinue ? 'Ready' : 'Completed'}</p>
            </div>
            <div className="border border-[#e4e1da] rounded-xl p-4">
              <BarChart3 className="w-4 h-4 text-[#2d6a55] mb-2" />
              <p className="text-xs text-[#a8a49d]">Score</p>
              <p className="text-sm text-[#1c1c1a] font-medium">{selectedScore ?? '--'} / 100</p>
            </div>
          </div>
        </div>

        {applications.length > 0 && (
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <Users className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h2 className="text-[#1c1c1a] font-semibold">Application History</h2>
                <p className="text-xs text-[#6b7063]">Choose an applied position to continue, review feedback, or track progress.</p>
              </div>
              {candidateData.resumeUrl && (
                <a
                  href={`${API_ORIGIN}${candidateData.resumeUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex mt-4 text-xs text-[#2d6a55] font-semibold hover:underline"
                >
                  View uploaded resume PDF
                </a>
              )}
            </div>
            <div className="space-y-2">
              {applications.map(application => {
                const position = allPositions.find(item => item.id === application.position_id);
                const isSelected = application.application_id === selectedApplication?.application_id;
                const applicationStatus = normalizeApplicationStatus(application.status);
                return (
                  <button
                    key={application.application_id}
                    onClick={() => {
                      const status = normalizeApplicationStatus(application.status);
                      setSelectedApplicationId(application.application_id);
                      onUpdateCandidate({
                        ...candidateData,
                        selectedApplicationId: application.application_id,
                        jobId: application.position_id,
                        position: position?.title || candidateData.position,
                        status,
                        progress: application.progress ?? (status === 'completed' ? 100 : status === 'screening' ? 70 : 40),
                        appliedAt: application.applied_at,
                        customQuestions: application.custom_questions,
                        sandboxAnswers: application.answers,
                        score: application.evaluation?.screening_score,
                        evaluation: application.evaluation
                      });
                    }}
                    className={`w-full text-left border rounded-xl p-4 transition-colors ${isSelected ? 'border-[#2d6a55]/40 bg-[#f0f9f4]' : 'border-[#e4e1da] hover:bg-[#f7f6f3]'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#1c1c1a] font-semibold">{position?.title || `Position #${application.position_id}`}</p>
                        <p className="text-xs text-[#6b7063] mt-0.5">{position?.department || 'Hiring team'}</p>
                        <p className="text-xs text-[#a8a49d] mt-2">Applied: {formatDateTime(application.applied_at)}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e8f2ee] text-[#2d6a55] whitespace-nowrap">
                        {statusLabels[applicationStatus]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          {canContinue && (
            <Link
              to="/candidate/sandbox"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2d6a55] text-white rounded-xl hover:bg-[#245747] transition-colors text-sm font-medium shadow-sm"
            >
              <PlayCircle className="w-4 h-4" />
              Continue Interview
            </Link>
          )}
          {canReview ? (
            <Link
              to="/candidate/feedback"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
            >
              <BarChart3 className="w-4 h-4" />
              Review Results
            </Link>
          ) : selectedApplication ? (
            <Link
              to="/candidate/sandbox"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-xl hover:bg-[#f7f6f3] transition-colors text-sm font-medium shadow-sm"
            >
              <BarChart3 className="w-4 h-4" />
              View Session
            </Link>
          ) : (
            <div className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border border-[#e4e1da] text-[#a8a49d] rounded-xl text-sm font-medium shadow-sm">
              <BarChart3 className="w-4 h-4" />
              Apply to a position
            </div>
          )}
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mt-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-[#2d6a55]" />
            </div>
            <div>
              <h2 className="text-[#1c1c1a] font-semibold">Available Positions</h2>
              <p className="text-xs text-[#6b7063]">Apply when you are ready to start a personalized interview session.</p>
            </div>
          </div>

          <div className="space-y-3">
            {positions.map(position => (
              <div key={position.id} className="border border-[#e4e1da] rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-[#1c1c1a] font-semibold">{position.title}</p>
                    <p className="text-xs text-[#6b7063] mb-2">{position.department}</p>
                    <p className="text-xs text-[#6b7063] leading-relaxed">{position.description}</p>
                    <p className="text-xs text-[#a8a49d] mt-2">
                      Open: {formatDateTime(position.open_time)} to {formatDateTime(position.end_time)}
                      <span className="ml-2 text-[#2d6a55] font-semibold">{position.application_count || 0} applied</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {position.requirements?.map((requirement: string, index: number) => (
                        <span key={index} className="px-2 py-0.5 bg-[#f0ede8] rounded-full text-xs text-[#6b7063]">
                          {requirement}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleApply(position)}
                    disabled={isApplying !== null || appliedPositionIds.has(position.id) || !candidateData.profileVerified}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:opacity-50 transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    {isApplying === position.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    {!candidateData.profileVerified ? 'Verify Profile' : appliedPositionIds.has(position.id) ? 'Applied' : 'Apply'}
                  </button>
                </div>
              </div>
            ))}
            {positions.length === 0 && (
              <p className="text-sm text-[#6b7063] py-6 text-center">No active positions are available right now.</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mt-5">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="w-4 h-4 text-[#2d6a55]" />
            <h2 className="text-[#1c1c1a] font-semibold">Agent & Hiring Manager Feedback</h2>
          </div>
          {candidateData.evaluation?.critiques?.length ? (
            <div className="space-y-3">
              {candidateData.evaluation.critiques.map((item: any, index: number) => (
                <div key={index} className="border-l-2 border-[#2d6a55] bg-[#f7f6f3] rounded-r-xl p-3">
                  <p className="text-xs text-[#2d6a55] font-semibold mb-1">Question {index + 1}</p>
                  <p className="text-xs text-[#6b7063]">{item.critique}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#6b7063]">Feedback will appear here after you complete an interview and the hiring manager reviews your progress.</p>
          )}
        </div>
      </div>
    </div>
  );
}
