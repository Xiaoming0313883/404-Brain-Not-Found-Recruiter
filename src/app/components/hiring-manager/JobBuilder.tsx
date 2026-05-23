import { useState } from 'react';
import { Job, ScrapedCandidate } from '../HiringManagerPortal';
import { Plus, Briefcase, Calendar, X, Loader2, Edit3, Power, Bot, Send, Clock, Users, Trash2 } from 'lucide-react';

interface Props {
  jobs: Job[];
  candidates: ScrapedCandidate[];
  onAddJob: (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>;
  onUpdateJob: (jobId: number, updates: Partial<Omit<Job, 'id' | 'createdAt'>>) => Promise<void>;
  onDeleteJob: (jobId: number) => Promise<void>;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_UNREACHABLE_MESSAGE =
  'Cannot reach the FastAPI backend at http://localhost:8000. Start the backend server, then try again.';

const toDateTimeLocalValue = (value?: string | Date) => {
  if (!value) return '';
  if (value instanceof Date) {
    const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
  }
  return value.slice(0, 16);
};

const getDefaultOpenTime = () => toDateTimeLocalValue(new Date());

const getDefaultEndTime = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return toDateTimeLocalValue(date);
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const statusLabels: Record<string, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  closed: 'Closed',
  inactive: 'Inactive'
};

export function JobBuilder({ jobs, candidates, onAddJob, onUpdateJob, onDeleteJob }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [openTime, setOpenTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [requirementInput, setRequirementInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [builderStep, setBuilderStep] = useState<'basic' | 'intake'>('basic');
  const [actionError, setActionError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [intakeContext, setIntakeContext] = useState<Record<string, any>>({});
  const [isIntakeComplete, setIsIntakeComplete] = useState(false);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'agent' | 'manager'; content: string }>>([
    { role: 'agent', content: 'Enter the basic position details, then I will ask adaptive follow-up questions and prefill editable draft values.' }
  ]);

  const startCreate = () => {
    resetForm();
    setOpenTime(getDefaultOpenTime());
    setEndTime(getDefaultEndTime());
    setBuilderStep('basic');
    setIsCreating(true);
  };

  const handlePublish = async () => {
    if (!title || !department || !openTime || !endTime || !isIntakeComplete) return;

    setIsProcessing(true);
    setActionError('');
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const generatedDescription = buildGeneratedDescription();
      const generatedRequirements = buildGeneratedRequirements();

      await onAddJob({
        title,
        department,
        description: generatedDescription,
        requirements: generatedRequirements,
        active,
        openTime,
        endTime,
        sourcingCriteria: buildSourcingCriteria(),
        intakeChat: chatMessages.map(message => ({ role: message.role, content: message.content }))
      });

      resetForm();
    } catch (err: any) {
      setActionError(err instanceof TypeError ? API_UNREACHABLE_MESSAGE : err.message || 'Failed to publish position.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDepartment('');
    setDescription('');
    setActive(true);
    setOpenTime('');
    setEndTime('');
    setRequirements([]);
    setRequirementInput('');
    setDeletingJobId(null);
    setEditingId(null);
    setIsCreating(false);
    setBuilderStep('basic');
    setChatInput('');
    setIntakeContext({});
    setIsIntakeComplete(false);
    setIsAgentThinking(false);
    setChatMessages([{ role: 'agent', content: 'Enter the basic position details, then I will ask adaptive follow-up questions and prefill editable draft values.' }]);
  };

  const handleEdit = (job: Job) => {
    setEditingId(job.id);
    setIsCreating(false);
    setBuilderStep('basic');
    setTitle(job.title);
    setDepartment(job.department);
    setDescription(job.description);
    setActive(job.active ?? true);
    setOpenTime(toDateTimeLocalValue(job.openTime));
    setEndTime(toDateTimeLocalValue(job.endTime));
    setRequirements(job.requirements);
    setRequirementInput('');
    setIntakeContext(job.sourcingCriteria || {});
    setIsIntakeComplete(Boolean(job.sourcingCriteria?.generated_description || job.description));
    setChatMessages((job.intakeChat as Array<{ role: 'agent' | 'manager'; content: string }>)?.length
      ? job.intakeChat as Array<{ role: 'agent' | 'manager'; content: string }>
      : [{ role: 'agent', content: 'I can continue refining this position. Tell me what changed about the role, team, or candidate profile.' }]
    );
    setActionError('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !title || !department || !openTime || !endTime || !isIntakeComplete) return;
    setIsProcessing(true);
    setActionError('');
    try {
      const generatedDescription = buildGeneratedDescription();
      const generatedRequirements = buildGeneratedRequirements();
      await onUpdateJob(editingId, {
        title,
        department,
        description: generatedDescription,
        requirements: generatedRequirements,
        active,
        openTime,
        endTime,
        sourcingCriteria: buildSourcingCriteria(),
        intakeChat: chatMessages.map(message => ({ role: message.role, content: message.content }))
      });
      resetForm();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update position.');
    } finally {
      setIsProcessing(false);
    }
  };

  const buildGeneratedRequirements = () => {
    return requirements.length
      ? requirements
      : intakeContext.generated_requirements?.length
        ? intakeContext.generated_requirements
        : [`Role-aligned experience for ${title}`, `Relevant ${department} domain knowledge`];
  };

  const buildGeneratedDescription = () => {
    return description || intakeContext.generated_description || `${title} role in ${department}.`;
  };

  const addRequirement = () => {
    const value = requirementInput.trim();
    if (!value) return;
    setRequirements(prev => prev.some(item => item.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]);
    setRequirementInput('');
  };

  const removeRequirement = (index: number) => {
    setRequirements(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const resetAgentPrefill = () => {
    if (intakeContext.generated_description) {
      setDescription(intakeContext.generated_description);
    }
    if (intakeContext.generated_requirements?.length) {
      setRequirements(intakeContext.generated_requirements);
    }
  };

  const buildSourcingCriteria = () => ({
    ...intakeContext,
    generated_description: buildGeneratedDescription(),
    generated_requirements: buildGeneratedRequirements(),
    completeness_score: isIntakeComplete ? 100 : 50,
    agent_summary: intakeContext.agent_summary || `Search profile for ${title} in ${department}.`
  });

  const requestRequirementAgentTurn = async (messages: Array<{ role: 'agent' | 'manager'; content: string }>) => {
    setIsAgentThinking(true);
    setActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/jobs/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, department, chat_messages: messages })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Requirement Agent could not continue intake.');
      }
      const data = await response.json();
      setIntakeContext(data.context || {});
      setIsIntakeComplete(Boolean(data.is_complete));
      if (data.is_complete) {
        if (data.context?.generated_description) {
          setDescription(data.context.generated_description);
        }
        if (data.context?.generated_requirements?.length) {
          setRequirements(data.context.generated_requirements);
        }
        setChatMessages([
          ...messages,
          { role: 'agent', content: data.context?.agent_summary || 'I prepared draft values below. Please edit them before saving the position.' }
        ]);
      } else {
        setChatMessages([...messages, { role: 'agent', content: data.question }]);
      }
    } catch (err: any) {
      setActionError(err instanceof TypeError ? API_UNREACHABLE_MESSAGE : err.message || 'Requirement Agent intake failed.');
    } finally {
      setIsAgentThinking(false);
    }
  };

  const beginAdaptiveIntake = () => {
    setBuilderStep('intake');
    setIsIntakeComplete(false);
    setIntakeContext({});
    requestRequirementAgentTurn([]);
  };

  const handleChatSubmit = () => {
    const answer = chatInput.trim();
    if (!answer || isIntakeComplete || isAgentThinking) return;

    const nextMessages: Array<{ role: 'agent' | 'manager'; content: string }> = [
      ...chatMessages,
      { role: 'manager', content: answer }
    ];
    setChatMessages(nextMessages);
    setChatInput('');
    requestRequirementAgentTurn(nextMessages);
  };

  const handleToggleActive = async (job: Job) => {
    setActionError('');
    try {
      await onUpdateJob(job.id, { active: !job.active });
    } catch (err: any) {
      setActionError(err.message || 'Failed to update position status.');
    }
  };

  const handleDeleteJob = async (job: Job) => {
    const applicantCount = applicantsForJob(job.id).length;
    const applicantText = applicantCount
      ? ` This position has ${applicantCount} current ${applicantCount === 1 ? 'applicant' : 'applicants'}; their pipeline records will remain.`
      : '';

    if (!window.confirm(`Delete "${job.title}"?${applicantText}`)) return;

    setActionError('');
    setDeletingJobId(job.id);
    try {
      await onDeleteJob(job.id);
      if (editingId === job.id) {
        resetForm();
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete position.');
    } finally {
      setDeletingJobId(null);
    }
  };

  const visibleJobs = editingId ? jobs.filter(job => job.id !== editingId) : jobs;
  const basicInfoReady = Boolean(title && department && openTime && endTime);
  const applicantsForJob = (jobId: number) =>
    candidates.filter(candidate => candidate.jobId === jobId && ['applied', 'screening', 'completed'].includes(candidate.status));

  const getStatusClasses = (status?: string) => {
    if (status === 'open') return 'bg-[#e8f2ee] text-[#2d6a55]';
    if (status === 'scheduled') return 'bg-[#e8eef8] text-[#3a5d9e]';
    if (status === 'closed') return 'bg-[#fdf8ee] text-[#9b6b1f]';
    return 'bg-[#f0ede8] text-[#a8a49d]';
  };

  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-[#e4e1da] rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:border-[#2d6a55] focus:ring-1 focus:ring-[#2d6a55]/20 transition-colors";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#1c1c1a]">Job Specification Builder</h2>
          <p className="text-sm text-[#6b7063] mt-0.5">Create and manage open positions</p>
        </div>
        {!isCreating && !editingId && (
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New Position
          </button>
        )}
      </div>

      {actionError && (
        <div className="p-4 bg-[#fdf2f2] border border-[#f5c2c2] text-[#b91c1c] rounded-xl text-sm">
          {actionError}
        </div>
      )}

      {/* Job Creation Form */}
      {(isCreating || editingId) && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[#1c1c1a]">{editingId ? 'Edit Job Posting' : 'New Job Posting'}</h3>
              <p className="text-xs text-[#6b7063] mt-1">
                {builderStep === 'basic' ? 'Step 1 of 2: Basic position information' : 'Step 2 of 2: AI intake for deeper sourcing details'}
              </p>
            </div>
            <button
              onClick={resetForm}
              className="text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {builderStep === 'basic' && (
          <>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Job Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Senior Full-Stack Engineer"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Department *</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              >
                <option value="">Select department...</option>
                <option value="Engineering">Engineering</option>
                <option value="Design">Design</option>
                <option value="Product">Product</option>
                <option value="Analytics">Analytics</option>
                <option value="Infrastructure">Infrastructure</option>
                <option value="Operations">Operations</option>
                <option value="Food Services">Food Services</option>
                <option value="Hospitality">Hospitality</option>
                <option value="Retail">Retail</option>
                <option value="Sales">Sales</option>
                <option value="Marketing">Marketing</option>
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Open Time *</label>
              <input
                type="datetime-local"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">End Time *</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-sm text-[#1c1c1a]">Position Status</label>
              <select
                value={active ? 'active' : 'inactive'}
                onChange={(e) => setActive(e.target.value === 'active')}
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-[#e8f2ee] rounded-lg flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <p className="text-sm text-[#1c1c1a] font-semibold">The Job Builder Agent creates editable draft values</p>
                <p className="text-xs text-[#6b7063] mt-1 leading-relaxed">
                  The next step asks adaptive questions based on the position title and your answers. The agent only prefills the description and requirements; you can edit the final saved values before publishing.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#e4e1da]">
            <button
              onClick={beginAdaptiveIntake}
              disabled={!basicInfoReady}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors"
            >
              Continue to AI Intake
            </button>
          </div>
          </>
          )}

          {builderStep === 'intake' && (
          <>
          <div className="bg-[#f7f6f3] border border-[#e4e1da] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 bg-[#e8f2ee] rounded-xl flex items-center justify-center">
                <Bot className="w-4 h-4 text-[#2d6a55]" />
              </div>
              <div>
                <h4 className="text-[#1c1c1a] font-semibold">Sourcing Intake Agent</h4>
                <p className="text-xs text-[#6b7063]">
                  {isIntakeComplete ? 'Ready to source candidates' : isAgentThinking ? 'Requirement Agent is preparing the next question' : 'Requirement Agent is collecting role context'}
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#e4e1da] rounded-xl p-4 max-h-80 overflow-auto space-y-3 mb-4">
              {chatMessages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'manager' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === 'manager'
                      ? 'bg-[#2d6a55] text-white'
                      : 'bg-[#f0ede8] text-[#1c1c1a]'
                  }`}>
                    {message.content}
                  </div>
                </div>
              ))}
              {isAgentThinking && (
                <div className="flex justify-start">
                  <div className="max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed bg-[#f0ede8] text-[#6b7063] inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Requirement Agent is thinking...
                  </div>
                </div>
              )}
            </div>

            {!isIntakeComplete ? (
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                  placeholder="Answer the agent..."
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim() || isAgentThinking}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors text-sm"
                >
                  {isAgentThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-[#e8f2ee] border border-[#c8e6d8] rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[#2d6a55] font-semibold uppercase tracking-wider mb-1">Agent Prefill Ready</p>
                      <p className="text-sm text-[#3d5a4a] leading-relaxed">{buildSourcingCriteria().agent_summary}</p>
                    </div>
                    <button
                      onClick={resetAgentPrefill}
                      className="text-xs text-[#2d6a55] font-semibold hover:underline whitespace-nowrap"
                    >
                      Reset Draft
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-[#e4e1da] rounded-xl p-4 space-y-4">
                  <div>
                    <label className="block mb-1.5 text-sm text-[#1c1c1a] font-medium">Editable Position Description *</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      placeholder="Edit the candidate-facing position description..."
                      className={`${inputClass} resize-none`}
                    />
                    <p className="text-xs text-[#a8a49d] mt-1">This text is saved exactly as the hiring manager edits it.</p>
                  </div>

                  <div>
                    <label className="block mb-1.5 text-sm text-[#1c1c1a] font-medium">Editable Requirement Tags *</label>
                    <div className="flex gap-2 mb-3">
                      <input
                        value={requirementInput}
                        onChange={(e) => setRequirementInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addRequirement();
                          }
                        }}
                        placeholder="Add a requirement tag..."
                        className={`flex-1 ${inputClass}`}
                      />
                      <button
                        onClick={addRequirement}
                        disabled={!requirementInput.trim()}
                        className="px-4 py-2.5 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {requirements.map((requirement, index) => (
                        <span key={`${requirement}-${index}`} className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#f0ede8] text-[#6b7063] rounded-full text-xs">
                          {requirement}
                          <button
                            onClick={() => removeRequirement(index)}
                            className="text-[#a8a49d] hover:text-[#b91c1c]"
                            title="Remove requirement"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {requirements.length === 0 && (
                        <p className="text-xs text-[#a8a49d]">No requirements yet. Add at least one tag before publishing.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#e4e1da]">
            <button
              onClick={() => setBuilderStep('basic')}
              className="w-full mb-3 py-3 bg-white border border-[#e4e1da] text-[#1c1c1a] rounded-lg hover:bg-[#f7f6f3] transition-colors"
            >
              Back to Basic Info
            </button>
            <button
              onClick={handlePublish}
              hidden={Boolean(editingId)}
              disabled={!title || !department || !openTime || !endTime || !isIntakeComplete || !description.trim() || requirements.length === 0 || isProcessing}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? (
                <div className="flex items-center justify-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving hiring-manager edits...
                </div>
              ) : (
                'Publish Job Posting'
              )}
            </button>
            {editingId && (
              <button
                onClick={handleSaveEdit}
                disabled={!title || !department || !openTime || !endTime || !isIntakeComplete || !description.trim() || requirements.length === 0 || isProcessing}
                className="w-full py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? (
                  <div className="flex items-center justify-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving position...
                  </div>
                ) : (
                  'Save Position'
                )}
              </button>
            )}

            {isProcessing && (
              <div className="mt-4 bg-[#f0ede8] border border-[#e4e1da] rounded-lg p-4">
                <p className="text-xs text-[#6b7063] mb-2 uppercase tracking-wider">Processing</p>
                <ul className="text-sm text-[#6b7063] space-y-1">
                  <li>Extracting job pillars and requirements...</li>
                  <li>Constructing Boolean search query vectors...</li>
                  <li>Optimizing for LinkedIn candidate sourcing...</li>
                </ul>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}

      {/* Active Jobs List */}
      <div>
        <p className="text-sm text-[#6b7063] mb-4">
          Positions ({jobs.length}) - {jobs.filter(job => job.isOpenForApplications).length} open now
          {editingId ? ' - editing position hidden from list' : ''}
        </p>
        <div className="space-y-3">
          {visibleJobs.map(job => {
            const applicants = applicantsForJob(job.id);
            return (
            <div
              key={job.id}
              className="bg-white border border-[#e4e1da] rounded-2xl p-6 hover:border-[#2d6a55]/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-[#e8f2ee] rounded-xl flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-5 h-5 text-[#2d6a55]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-[#1c1c1a]">{job.title}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusClasses(job.applicationStatus)}`}>
                        {statusLabels[job.applicationStatus || 'open'] || 'Open'}
                      </span>
                    </div>
                    <p className="text-sm text-[#6b7063]">{job.department}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[#a8a49d]">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDateTime(job.openTime)} to {formatDateTime(job.endTime)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        {applicants.length} {applicants.length === 1 ? 'applicant' : 'applicants'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(job)}
                    className="inline-flex items-center justify-center w-8 h-8 border border-[#e4e1da] rounded-lg text-[#6b7063] hover:text-[#1c1c1a] hover:bg-[#f7f6f3] transition-colors"
                    title="Edit position"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(job)}
                    disabled={deletingJobId === job.id}
                    className={`inline-flex items-center justify-center w-8 h-8 border rounded-lg transition-colors ${job.active ? 'border-[#e4e1da] text-[#2d6a55] hover:bg-[#f7f6f3]' : 'border-[#e4e1da] text-[#a8a49d] hover:bg-[#f7f6f3]'}`}
                    title={job.active ? 'Deactivate position' : 'Activate position'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteJob(job)}
                    disabled={deletingJobId === job.id}
                    className="inline-flex items-center justify-center w-8 h-8 border border-[#f0c9c9] rounded-lg text-[#b91c1c] hover:bg-[#fdf2f2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Delete position"
                  >
                    {deletingJobId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  <div className="flex items-center gap-1.5 text-xs text-[#a8a49d] ml-2">
                    <Calendar className="w-3.5 h-3.5" />
                    {job.createdAt.toLocaleDateString()}
                  </div>
                </div>
              </div>

              <p className="text-sm text-[#6b7063] mb-4 leading-relaxed">
                {job.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {job.requirements.map((req, index) => (
                  <span
                    key={index}
                    className="px-2.5 py-1 bg-[#f0ede8] text-[#6b7063] rounded-full text-xs"
                  >
                    {req}
                  </span>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-[#e4e1da]">
                <p className="text-xs tracking-wider uppercase text-[#a8a49d] mb-2 font-semibold">Current Applicants</p>
                {applicants.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {applicants.slice(0, 4).map(candidate => (
                      <span key={`${candidate.email}-${candidate.applicationId || candidate.jobId}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f7f6f3] border border-[#e4e1da] rounded-full text-xs text-[#6b7063]">
                        {candidate.name}
                        <span className="text-[#a8a49d]">({candidate.status})</span>
                      </span>
                    ))}
                    {applicants.length > 4 && (
                      <span className="px-2.5 py-1 text-xs text-[#a8a49d]">+{applicants.length - 4} more</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#a8a49d]">No candidate has applied to this position yet.</p>
                )}
              </div>
            </div>
          );
          })}

          {visibleJobs.length === 0 && !isCreating && !editingId && (
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-16 text-center">
              <div className="w-12 h-12 bg-[#f0ede8] rounded-xl flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-6 h-6 text-[#a8a49d]" />
              </div>
              <h4 className="text-[#1c1c1a] mb-2">No Active Positions</h4>
              <p className="text-sm text-[#6b7063] mb-6">
                Create your first job posting to start sourcing candidates
              </p>
              <button
                onClick={startCreate}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Create Position
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
