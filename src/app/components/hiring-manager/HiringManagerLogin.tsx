import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { BrandLogo } from '../BrandLogo';

interface Props {
  onAuthenticate: (user: { name: string; email: string; role: string }) => void;
}

const mockAccounts = {
  'admin@company.com': { password: 'password', name: 'Jordan Blake', role: 'Head of Talent Acquisition' },
  'hiring@company.com': { password: 'password', name: 'Alex Morgan', role: 'Hiring Manager' },
};

export function HiringManagerLogin({ onAuthenticate }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const account = mockAccounts[email as keyof typeof mockAccounts];

    if (!account || account.password !== password) {
      setError('Invalid email or password. Please try again.');
      return;
    }

    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 900));

    onAuthenticate({ name: account.name, email, role: account.role });
    setIsLoading(false);
  };

  const inputClass = (hasError: boolean) =>
    `w-full px-3.5 py-2.5 bg-white border rounded-lg text-[#1c1c1a] placeholder-[#a8a49d] focus:outline-none focus:ring-1 transition-colors text-sm ${
      hasError
        ? 'border-[#c25a2a]/50 focus:border-[#c25a2a] focus:ring-[#c25a2a]/20'
        : 'border-[#e4e1da] focus:border-[#2d6a55] focus:ring-[#2d6a55]/20'
    }`;

  return (
    <div className="min-h-screen bg-[#f7f6f3] flex items-center justify-center p-6">
      {/* Back link */}
      <div className="absolute top-6 left-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-[#6b7063] hover:text-[#1c1c1a] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          All Portals
        </Link>
      </div>

      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-10">
          <BrandLogo className="justify-center mb-5" imageClassName="h-20" />
          <p className="text-xs tracking-[0.2em] uppercase text-[#2d6a55] mb-2">Hiring Manager Portal</p>
          <h1 className="text-[#1c1c1a]">Sign In to 404Hire</h1>
          <p className="text-sm text-[#6b7063] mt-2">Access your recruitment workspace</p>
        </div>

        {/* Form */}
        <div className="bg-white border border-[#e4e1da] rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm text-[#1c1c1a] mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="you@company.com"
                autoComplete="email"
                className={inputClass(!!error)}
                required
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-[#1c1c1a]">Password</label>
                <button
                  type="button"
                  className="text-xs text-[#2d6a55] hover:text-[#245747] transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={`${inputClass(!!error)} pr-11`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#a8a49d] hover:text-[#6b7063] transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-[#c25a2a] bg-[#fdf6f3] border border-[#f0c8b8] rounded-lg px-3 py-2.5">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!email || !password || isLoading}
              className="w-full py-2.5 bg-[#2d6a55] text-white rounded-lg hover:bg-[#245747] disabled:bg-[#e4e1da] disabled:text-[#a8a49d] disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Demo credentials */}
        <div className="mt-5 bg-[#f0ede8] border border-[#e4e1da] rounded-xl p-4">
          <p className="text-xs text-[#a8a49d] uppercase tracking-wider mb-2.5">Demo Credentials</p>
          <div className="space-y-2">
            {Object.entries(mockAccounts).map(([email, { name, role }]) => (
              <button
                key={email}
                type="button"
                onClick={() => {
                  setEmail(email);
                  setPassword('password');
                  setError('');
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-white border border-[#e4e1da] rounded-lg hover:border-[#2d6a55]/30 transition-colors text-left group"
              >
                <div>
                  <p className="text-xs text-[#1c1c1a]">{name}</p>
                  <p className="text-xs text-[#a8a49d]">{role}</p>
                </div>
                <span className="text-xs text-[#2d6a55] opacity-0 group-hover:opacity-100 transition-opacity">
                  Use this
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-[#a8a49d] mt-2.5">Password for all accounts: <span className="text-[#6b7063]">password</span></p>
        </div>
      </div>
    </div>
  );
}
