import { useState } from 'react';
import { Job } from '../HiringManagerPortal';
import { Plus, Briefcase, Calendar, X, Loader2 } from 'lucide-react';

interface Props {
  jobs: Job[];
  onAddJob: (job: Omit<Job, 'id' | 'createdAt'>) => void;
}

export function JobBuilder({ jobs, onAddJob }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [requirementInput, setRequirementInput] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAddRequirement = () => {
    if (requirementInput.trim()) {
      setRequirements([...requirements, requirementInput.trim()]);
      setRequirementInput('');
    }
  };

  const handleRemoveRequirement = (index: number) => {
    setRequirements(requirements.filter((_, i) => i !== index));
  };

  const handlePublish = async () => {
    if (!title || !department || !description || requirements.length === 0) return;

    setIsProcessing(true);
    await new Promise(resolve => setTimeout(resolve, 1500));

    onAddJob({ title, department, description, requirements });

    setTitle('');
    setDepartment('');
    setDescription('');
    setRequirements([]);
    setIsCreating(false);
    setIsProcessing(false);
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
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New Position
          </button>
        )}
      </div>

      {/* Job Creation Form */}
      {isCreating && (
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[#1c1c1a]">New Job Posting</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

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
                <option value="Sales">Sales</option>
                <option value="Marketing">Marketing</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block mb-1.5 text-sm text-[#1c1c1a]">Job Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the role, responsibilities, and what makes this position compelling..."
              className={`${inputClass} resize-none`}
              rows={5}
            />
          </div>

          <div>
            <label className="block mb-1.5 text-sm text-[#1c1c1a]">Requirements *</label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={requirementInput}
                onChange={(e) => setRequirementInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddRequirement()}
                placeholder="Add a requirement and press Enter"
                className={`flex-1 ${inputClass}`}
              />
              <button
                onClick={handleAddRequirement}
                className="px-4 py-2.5 bg-[#f0ede8] text-[#1c1c1a] rounded-lg hover:bg-[#e8e4dc] transition-colors text-sm whitespace-nowrap"
              >
                Add
              </button>
            </div>
            {requirements.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {requirements.map((req, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#e8f2ee] text-[#2d6a55] rounded-full text-sm"
                  >
                    {req}
                    <button
                      onClick={() => handleRemoveRequirement(index)}
                      className="text-[#2d6a55]/60 hover:text-[#2d6a55] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#e4e1da]">
            <button
              onClick={handlePublish}
              disabled={!title || !department || !description || requirements.length === 0 || isProcessing}
              className="w-full py-3 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? (
                <div className="flex items-center justify-center gap-2.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing with Employer Requirement Agent...
                </div>
              ) : (
                'Publish Job Posting'
              )}
            </button>

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
        </div>
      )}

      {/* Active Jobs List */}
      <div>
        <p className="text-sm text-[#6b7063] mb-4">Active Positions ({jobs.length})</p>
        <div className="space-y-3">
          {jobs.map(job => (
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
                    <h4 className="text-[#1c1c1a] mb-0.5">{job.title}</h4>
                    <p className="text-sm text-[#6b7063]">{job.department}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#a8a49d]">
                  <Calendar className="w-3.5 h-3.5" />
                  {job.createdAt.toLocaleDateString()}
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
            </div>
          ))}

          {jobs.length === 0 && !isCreating && (
            <div className="bg-white border border-[#e4e1da] rounded-2xl p-16 text-center">
              <div className="w-12 h-12 bg-[#f0ede8] rounded-xl flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-6 h-6 text-[#a8a49d]" />
              </div>
              <h4 className="text-[#1c1c1a] mb-2">No Active Positions</h4>
              <p className="text-sm text-[#6b7063] mb-6">
                Create your first job posting to start sourcing candidates
              </p>
              <button
                onClick={() => setIsCreating(true)}
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
