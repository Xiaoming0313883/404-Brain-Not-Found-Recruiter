import { ArrowLeft, Award, Briefcase, FileText, Home, LogOut, UserCircle } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { BrandLogo } from "../BrandLogo";

const tabs = [
  { label: "Dashboard", path: "/candidate/home", icon: Home },
  { label: "Profile", path: "/candidate/profile", icon: UserCircle },
  { label: "Application", path: "/candidate/applications", icon: FileText },
  { label: "Interview Results", path: "/candidate/feedback", icon: Award },
  { label: "Jobs", path: "/candidate/jobs", icon: Briefcase },
];

function isActiveRoute(currentPath: string, tabPath: string) {
  return currentPath === tabPath || currentPath.startsWith(`${tabPath}/`);
}

export function CandidateNav({ onSignOut }: { onSignOut?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    } else {
      localStorage.removeItem("candidateEmail");
      localStorage.removeItem("candidateName");
      localStorage.removeItem("candidateSession");
      localStorage.removeItem("authToken");
    }
    navigate("/");
  };

  return (
    <header className="mb-8">
      <div className="bg-white border-b border-[#e4e1da] shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link to="/candidate/home" className="flex items-center gap-3 mb-0.5">
                <BrandLogo imageClassName="h-14" />
                <h1 className="text-[#1c1c1a] text-lg font-semibold">Candidate Portal</h1>
              </Link>
              <p className="text-xs text-[#6b7063]">AI-Powered Application Workspace</p>
            </div>

            <div className="flex items-center gap-5">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">All Portals</span>
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b border-[#e4e1da] shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-0 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActiveRoute(currentPath, tab.path);
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-shrink-0 items-center gap-2 px-5 py-3.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "border-[#2d6a55] text-[#2d6a55]"
                      : "border-transparent text-[#6b7063] hover:text-[#1c1c1a] hover:border-[#e4e1da]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}

export default CandidateNav;
