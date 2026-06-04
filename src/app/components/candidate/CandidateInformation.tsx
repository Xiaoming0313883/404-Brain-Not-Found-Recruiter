import { useEffect, useState, useRef } from 'react';
import { FileText, Loader2, Save, Upload, User } from 'lucide-react';
import { toast } from 'sonner';
import { CandidateData } from '../CandidatePortal';
import { PdfResumeViewer } from '../PdfResumeViewer';
import { CandidateNav } from './CandidateNav';
import { API_BASE_URL, API_ORIGIN } from '../../api';

interface Props {
  candidateData: CandidateData;
  onUpdateCandidate: (data: CandidateData) => void;
  onSignOut: () => void;
}

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const requiredProfileFields = [
  ['name', 'Full name'],
  ['age', 'Age'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['cameFrom', 'Came from'],
  ['workExperience', 'Work experience'],
  ['qualification', 'Qualification'],
  ['gradeResults', 'Grade and results']
] as const;

export function CandidateInformation({ candidateData, onUpdateCandidate, onSignOut }: Props) {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
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
  const [resume, setResume] = useState<File | null>(null);
  const [picture, setPicture] = useState<File | null>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const missingFields = requiredProfileFields.filter(([field]) => !String((form as any)[field] || '').trim());

  useEffect(() => {
    if (errorMessage) toast.error(errorMessage);
  }, [errorMessage]);

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

  const mergeCandidate = (data: any) => {
    onUpdateCandidate({
      ...candidateData,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      resumeUrl: data.resume_url,
      resumeSummary: data.resume_summary,
      profileVerified: data.profile_verified,
      profileMissingFields: data.profile_missing_fields || [],
      profileCompletion: data.profile_completion,
      age: data.profile_data?.age || '',
      phone: data.profile_data?.phone || '',
      address: data.profile_data?.address || '',
      cameFrom: data.profile_data?.came_from || '',
      location: data.profile_data?.location || '',
      headline: data.profile_data?.headline || '',
      about: data.profile_data?.about || '',
      workExperience: data.profile_data?.work_experience || '',
      qualification: data.profile_data?.qualification || '',
      gradeResults: data.profile_data?.grade_results || '',
      awards: data.profile_data?.awards || [],
      skills: data.profile_data?.skills || [],
      experiences: data.profile_data?.experiences || candidateData.experiences,
      education: data.profile_data?.education || candidateData.education,
      notifications: data.notifications || candidateData.notifications
    });
  };

  const saveProfile = async () => {
    setIsSaving(true);
    setErrorMessage('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          age: form.age,
          phone: form.phone,
          address: form.address,
          came_from: form.cameFrom,
          location: form.location,
          headline: form.headline,
          work_experience: form.workExperience,
          qualification: form.qualification,
          grade_results: form.gradeResults,
          awards: form.awards.split(',').map(item => item.trim()).filter(Boolean),
          skills: form.skills.split(',').map(item => item.trim()).filter(Boolean)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to save profile.');
      mergeCandidate(data);
      setMessage('Information details saved.');
      toast.success('Information details saved.');
    } catch (error: any) {
      setErrorMessage(error.message || 'Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const uploadFile = (kind: 'resume' | 'picture', selectedFile?: File | null) => {
    const file = kind === 'resume' ? resume : (selectedFile !== undefined ? selectedFile : picture);
    if (!file) return;
    if (kind === 'resume' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Please upload a PDF resume.');
      return;
    }
    if (kind === 'resume' && file.size > MAX_RESUME_BYTES) {
      setErrorMessage('Resume must be 10MB or smaller.');
      return;
    }
    if (kind === 'picture' && !file.type.startsWith('image/')) {
      setErrorMessage('Profile picture must be JPG, PNG, or WebP.');
      return;
    }
    if (kind === 'picture' && file.size > MAX_PROFILE_IMAGE_BYTES) {
      setErrorMessage('Profile picture must be 5MB or smaller.');
      return;
    }
    setIsSaving(true);
    setUploadProgress(0);
    setErrorMessage('');
    setMessage('');
    const formData = new FormData();
    formData.append(kind === 'resume' ? 'resume' : 'image', file);
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          mergeCandidate(data);
          setMessage(kind === 'resume' ? 'Resume updated successfully.' : 'Profile picture updated.');
          toast.success(kind === 'resume' ? 'Resume updated successfully.' : 'Profile picture updated.');
          if (kind === 'resume') setResume(null);
          if (kind === 'picture') setPicture(null);
        } else {
          setErrorMessage(data.detail || 'Upload failed.');
        }
      } catch {
        setErrorMessage('Upload failed. Server returned an unexpected response.');
      }
      setUploadProgress(null);
      setIsSaving(false);
    });
    xhr.addEventListener('error', () => {
      setErrorMessage('Upload failed. Please check your connection and try again.');
      setUploadProgress(null);
      setIsSaving(false);
    });
    xhr.addEventListener('timeout', () => {
      setErrorMessage('Upload timed out. The file may be too large, or your connection is slow.');
      setUploadProgress(null);
      setIsSaving(false);
    });
    xhr.timeout = 240000; // 4 minute timeout for resume agent graph processing
    xhr.open('POST', `${API_BASE_URL}/candidates/${encodeURIComponent(candidateData.email)}/${kind === 'resume' ? 'resume' : 'profile-picture'}`);
    xhr.send(formData);
  };

  const inputClass = "w-full px-3 py-2 border border-[#e4e1da] rounded-lg text-sm text-[#1c1c1a] focus:outline-none focus:border-[#2d6a55]";

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
        <CandidateNav
          onSignOut={onSignOut}
          candidateName={candidateData.name}
          candidateRole={candidateData.position || 'Candidate'}
        />
      <div className="px-6 py-10">
        <div className="max-w-4xl mx-auto">

        <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm mb-5">
          <div className="flex items-center gap-3 mb-5">
            <User className="w-5 h-5 text-[#2d6a55]" />
            <div>
              <h1 className="text-xl text-[#1c1c1a] font-semibold">Information</h1>
              <p className="text-xs text-[#6b7063]">Edit your details, profile picture, and resume.</p>
            </div>
          </div>
          {message && <div className="mb-4 rounded-xl border border-[#c8e6d8] bg-[#e8f2ee] p-3 text-sm text-[#2d6a55]">{message}</div>}
          {errorMessage && <div className="mb-4 rounded-xl border border-[#f5c2c2] bg-[#fdf2f2] p-3 text-sm text-[#b91c1c]">{errorMessage}</div>}
          <div className={`mb-5 rounded-xl border p-4 ${missingFields.length ? 'border-[#f2d3a4] bg-[#fff8ed]' : 'border-[#c8e6d8] bg-[#e8f2ee]'}`}>
            <p className={`text-sm font-semibold ${missingFields.length ? 'text-[#8a5a14]' : 'text-[#2d6a55]'}`}>
              {missingFields.length ? 'Missing Information Assistant' : 'Profile Information Complete'}
            </p>
            <p className="mt-1 text-xs text-[#6b7063] leading-relaxed">
              {missingFields.length
                ? `Complete ${missingFields.map(([, label]) => label.toLowerCase()).join(', ')} below, then save your details.`
                : 'All required profile details are filled in.'}
            </p>
          </div>

          <div className="text-right text-xs text-[#6b7063] mb-3">
            <span className="text-[#b91c1c] font-bold">*</span> Indicates a required field
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {[
              ['name', 'Full name'], ['age', 'Age'], ['phone', 'Phone'], ['address', 'Address'],
              ['cameFrom', 'Came from'], ['location', 'Location'], ['headline', 'Headline'],
              ['qualification', 'Qualification'], ['gradeResults', 'Grade and results'], ['skills', 'Skills'], ['awards', 'Awards']
            ].map(([field, label]) => {
              const isMandatory = ['name', 'age', 'phone', 'address', 'cameFrom', 'qualification', 'gradeResults'].includes(field);
              return (
                <div key={field}>
                  <label className="block text-xs text-[#6b7063] mb-1 font-semibold flex items-center justify-between">
                    <span>
                      {label}
                      {isMandatory && <span className="text-[#b91c1c] ml-0.5 font-bold">*</span>}
                    </span>
                    {!isMandatory && <span className="text-[#a8a49d] font-normal text-[10px] lowercase">(optional)</span>}
                  </label>
                  <input value={(form as any)[field]} onChange={(event) => setForm(current => ({ ...current, [field]: event.target.value }))} className={inputClass} />
                </div>
              );
            })}
            <div className="md:col-span-2">
              <label className="block text-xs text-[#6b7063] mb-1 font-semibold">
                Work experience
                <span className="text-[#b91c1c] ml-0.5 font-bold">*</span>
              </label>
              <textarea value={form.workExperience} onChange={(event) => setForm(current => ({ ...current, workExperience: event.target.value }))} rows={4} className={`${inputClass} resize-none`} />
            </div>
          </div>

          <button onClick={saveProfile} disabled={isSaving} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2d6a55] text-white text-sm font-medium disabled:opacity-50">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Details
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
            <FileText className="w-5 h-5 text-[#2d6a55] mb-3" />
            <h2 className="text-[#1c1c1a] font-semibold mb-2">Resume</h2>
            {candidateData.resumeUrl && (
              <div className="mb-4">
                <PdfResumeViewer url={`${API_ORIGIN}${candidateData.resumeUrl}`} filename={candidateData.resumeData?.filename || 'resume.pdf'} />
              </div>
            )}
            <input
              type="file"
              ref={resumeInputRef}
              accept=".pdf"
              onChange={(event) => setResume(event.target.files?.[0] || null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => resumeInputRef.current?.click()}
              disabled={isSaving}
              className={`w-full rounded-xl border-2 border-dashed px-4 py-5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                resume
                  ? 'border-[#2d6a55]/40 bg-[#f0f9f4] text-[#2d6a55]'
                  : 'border-[#e4e1da] text-[#6b7063] hover:border-[#2d6a55]/30 hover:bg-[#f7f6f3]'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Upload className="w-4 h-4" />
                {resume ? resume.name : 'Choose resume file'}
              </span>
            </button>
            {uploadProgress !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#6b7063] font-medium">Uploading resume...</span>
                  <span className="text-xs text-[#2d6a55] font-semibold">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-[#e4e1da] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[#2d6a55] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <button onClick={() => uploadFile('resume')} disabled={!resume || isSaving} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2d6a55] text-white text-sm disabled:opacity-50">
              {isSaving && uploadProgress !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isSaving && uploadProgress !== null ? `Uploading (${uploadProgress}%)` : 'Change Resume'}
            </button>
          </div>

          <div className="bg-white border border-[#e4e1da] rounded-2xl p-6 shadow-sm">
            <User className="w-5 h-5 text-[#2d6a55] mb-3" />
            <h2 className="text-[#1c1c1a] font-semibold mb-2">Profile Picture</h2>
            {candidateData.profilePictureUrl && !brokenImages[candidateData.email] ? (
              <img
                src={`${API_ORIGIN}${candidateData.profilePictureUrl}`}
                alt={candidateData.name}
                onError={() => {
                  setBrokenImages(prev => ({ ...prev, [candidateData.email]: true }));
                }}
                className="w-32 h-32 object-cover rounded-2xl border border-[#e4e1da] mb-4"
              />
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-[#e8f2ee] flex items-center justify-center text-[#2d6a55] text-3xl font-semibold mb-4">{candidateData.name.charAt(0).toUpperCase()}</div>
            )}
            <input
              type="file"
              ref={pictureInputRef}
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setPicture(file);
                if (file) {
                  uploadFile('picture', file);
                }
              }}
              className="hidden"
            />
            {uploadProgress !== null && picture && (
              <div className="mt-3 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#6b7063] font-medium">Uploading picture...</span>
                  <span className="text-xs text-[#2d6a55] font-semibold">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-[#e4e1da] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[#2d6a55] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            <button
              onClick={() => pictureInputRef.current?.click()}
              disabled={isSaving}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2d6a55] text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
            >
              {isSaving && uploadProgress !== null && picture ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isSaving && uploadProgress !== null && picture ? `Uploading (${uploadProgress}%)` : 'Upload Picture'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
