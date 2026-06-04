import { Link } from 'react-router';
import { ArrowRight, Users, Briefcase } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export function PortalSelector() {
  return (
    <div className="min-h-screen bg-[#f7f6f3] flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-16">
          <BrandLogo className="justify-center mb-1 overflow-hidden" imageClassName="w-52 md:w-64 lg:w-72 h-35 -my-3 max-w-[560px]" />
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-5">
            404 Brain Not Found. Talent Found. 👾
          </p>
          <h1 className="text-[#1c1c1a] mb-4">
            404Hire Recruitment Workspace
          </h1>
          <p className="text-[#6b7063] max-w-md mx-auto leading-relaxed">
            404Hire — Because Great Talent Shouldn’t Be “Not Found.”
          </p>
          <p className="text-sm text-[#6b7063] max-w-md mx-auto leading-relaxed mt-3">
            Hybrid dual-portal system with bias mitigation and trajectory-based candidate evaluation.
          </p>
        </div>

        {/* Portal Cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-16">
          <Link
            to="/candidate"
            className="group bg-white border border-[#e4e1da] rounded-2xl p-8 hover:border-[#2d6a55]/40 hover:shadow-md transition-all duration-200"
          >
            <div className="mb-8">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#e8f2ee] mb-6">
                <Users className="w-5 h-5 text-[#2d6a55]" />
              </div>
              <h2 className="text-[#1c1c1a] mb-3">Candidate Portal</h2>
              <p className="text-sm text-[#6b7063] leading-relaxed">
                Access your personalized screening workspace, complete warm-up challenges,
                and receive immediate feedback on your application.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-[#2d6a55] group-hover:gap-2.5 transition-all duration-200">
              <span>Enter Portal</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </Link>

          <Link
            to="/hiring-manager"
            className="group bg-white border border-[#e4e1da] rounded-2xl p-8 hover:border-[#2d6a55]/40 hover:shadow-md transition-all duration-200"
          >
            <div className="mb-8">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#e8f2ee] mb-6">
                <Briefcase className="w-5 h-5 text-[#2d6a55]" />
              </div>
              <h2 className="text-[#1c1c1a] mb-3">Hiring Manager Portal</h2>
              <p className="text-sm text-[#6b7063] leading-relaxed">
                Create job postings, source candidates via LinkedIn, and analyze
                your talent pipeline with AI-powered insights.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-[#2d6a55] group-hover:gap-2.5 transition-all duration-200">
              <span>Enter Portal</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </Link>
        </div>

        {/* Feature Strip */}
        <div className="border-t border-[#e4e1da] pt-10 grid md:grid-cols-3 gap-8">
          <div>
            <p className="text-xs tracking-[0.15em] uppercase text-[#1c1c1a] mb-2">Agentic State Graph</p>
            <p className="text-sm text-[#6b7063]">Supervisor-driven multi-agent routing for adaptive candidate evaluation</p>
          </div>
          <div>
            <p className="text-xs tracking-[0.15em] uppercase text-[#1c1c1a] mb-2">Prestige Neutralization</p>
            <p className="text-sm text-[#6b7063]">Focus on skills and potential, not brand names</p>
          </div>
          <div>
            <p className="text-xs tracking-[0.15em] uppercase text-[#1c1c1a] mb-2">Trajectory Analysis</p>
            <p className="text-sm text-[#6b7063]">Discover hidden gems with high learning velocity</p>
          </div>
        </div>

      </div>
    </div>
  );
}
