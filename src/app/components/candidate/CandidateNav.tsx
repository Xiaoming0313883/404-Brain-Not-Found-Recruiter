import { Link, useLocation } from 'react-router';
import { ArrowLeft, Briefcase, FileText, Home, LogOut, User } from 'lucide-react';

interface Props {
  onSignOut?: () => void;
}

const navItems = [
  { path: '/candidate/home', label: 'Overview', icon: Home },
  { path: '/candidate/profile', label: 'Profile', icon: User },
  { path: '/candidate/applications', label: 'Applications', icon: FileText },
  { path: '/candidate/jobs', label: 'Jobs', icon: Briefcase }
];

export function CandidateNav({ onSignOut }: Props) {
  const location = useLocation();

  return (
    <div className="mb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          All Portals
        </Link>
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#c25a2a] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        )}
      </div>
      <nav className="flex flex-wrap gap-1 rounded-2xl border border-[#e4e1da] bg-white p-1 shadow-sm">
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#e8f2ee] text-[#2d6a55]'
                  : 'text-[#6b7063] hover:bg-[#f7f6f3] hover:text-[#1c1c1a]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
