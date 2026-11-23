import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
} from 'lucide-react';
import { SSO_PROVIDER_FLAGS } from '../lib/adminAuth.ts';

interface LoginPageProps {
  onAdminSignIn: (email: string, password: string) => { ok: boolean; error?: string };
  onGoogleSignIn?: () => Promise<void>;
  authBusy?: boolean;
}

type SsoProviderId = keyof typeof SSO_PROVIDER_FLAGS;

const FEATURE_PILLS = [
  'Inventory',
  'Purchasing',
  'Sales',
  'Accounting',
  'Ledgers',
  'Financials',
];

const SSO_PROVIDERS: Array<{ id: SsoProviderId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'github', label: 'GitHub' },
  { id: 'microsoft', label: 'Microsoft' },
];

export const LoginPage: React.FC<LoginPageProps> = ({
  onAdminSignIn,
  onGoogleSignIn,
  authBusy = false,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoNotice, setSsoNotice] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSsoNotice(null);
    if (!email.trim() || !password) {
      setError('Please enter your admin email and password.');
      return;
    }
    const result = onAdminSignIn(email, password);
    if (!result.ok) {
      setError(result.error || 'Invalid admin email or password.');
    }
  };

  const handleSsoClick = (provider: { id: SsoProviderId; label: string }) => {
    setError(null);
    if (!SSO_PROVIDER_FLAGS[provider.id]) {
      setSsoNotice(
        `${provider.label} sign-in is currently inactive. Please sign in with your Admin email and password.`
      );
      return;
    }
    if (provider.id === 'google' && onGoogleSignIn) {
      void onGoogleSignIn();
    }
  };

  const renderProviderIcon = (id: SsoProviderId) => {
    if (id === 'google') {
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
      );
    }
    if (id === 'facebook') {
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#1877F2" />
          <path
            fill="#FFFFFF"
            d="M13.5 19v-6.2h2.1l.3-2.4h-2.4V8.9c0-.7.2-1.2 1.2-1.2h1.3V5.5c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.1-3.2 3.3v1.7H8.8v2.4h2.1V19h2.6z"
          />
        </svg>
      );
    }
    if (id === 'github') {
      return (
        <svg className="w-4 h-4 shrink-0 text-slate-200" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21" aria-hidden="true">
        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
      </svg>
    );
  };

  return (
    <div className="min-h-screen w-full flex bg-[#0A0D16] text-slate-100 select-none">
      {/* Left Authentication Panel */}
      <section className="w-full lg:w-[440px] xl:w-[460px] shrink-0 bg-[#0A0D16] border-r border-white/[0.06] flex flex-col justify-between p-8 sm:p-10">
        {/* Brand Top */}
        <div>
          <div className="text-sm font-extrabold tracking-tight text-white">
            ATCL ERP
          </div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-indigo-400 uppercase mt-0.5">
            ENTERPRISE PLATFORM
          </div>
        </div>

        {/* Sign-In Form */}
        <div className="w-full max-w-sm mx-auto my-8">
          <h1 className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-white flex items-center gap-2">
            <span>Welcome back</span>
            <span aria-hidden="true">👋</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1.5">
            Sign in to your ATCL ERP account to continue
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label
                htmlFor="erp-login-email"
                className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-2"
              >
                EMAIL
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="erp-login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="erpatcl@gmail.com"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#121726] border border-slate-700/70 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-slate-100 placeholder-slate-500 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="erp-login-password"
                className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-2"
              >
                PASSWORD
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="erp-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-[#121726] border border-slate-700/70 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl text-slate-100 placeholder-slate-500 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-xs text-rose-200"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-[#5B52F2] to-[#7467FF] hover:from-[#655DF5] hover:to-[#8175FF] shadow-[0_8px_30px_rgba(99,102,241,0.38)] flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
            >
              <span>Sign in</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-white/[0.08]" />
            <span className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase">
              OR
            </span>
            <div className="flex-1 h-px bg-white/[0.08]" />
          </div>

          {/* External SSO Providers (Inactive until enabled) */}
          <div className="grid grid-cols-2 gap-2.5">
            {SSO_PROVIDERS.map((provider) => {
              const isActive = SSO_PROVIDER_FLAGS[provider.id];
              return (
                <button
                  key={provider.id}
                  type="button"
                  aria-disabled={!isActive}
                  title={
                    isActive
                      ? `Continue with ${provider.label}`
                      : `${provider.label} sign-in is currently inactive`
                  }
                  onClick={() => handleSsoClick(provider)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-2 transition-all ${
                    isActive
                      ? 'text-slate-100 bg-[#121726] hover:bg-[#182035] border-slate-700/75 cursor-pointer'
                      : 'text-slate-300 bg-[#121726]/70 border-slate-800/90 opacity-65 hover:opacity-80 cursor-not-allowed'
                  }`}
                >
                  {renderProviderIcon(provider.id)}
                  <span>{provider.label}</span>
                </button>
              );
            })}
          </div>

          {ssoNotice && (
            <div
              role="status"
              className="mt-3 flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-amber-950/50 border border-amber-500/35 text-[11px] leading-relaxed text-amber-200"
            >
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>{ssoNotice}</span>
            </div>
          )}

          <p className="mt-3 text-center text-[10px] text-slate-500">
            External SSO providers are currently inactive · Admin sign-in only
          </p>
        </div>

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-500">
          Advance Technology Consortium Ltd. (ATCL) · <span className="text-indigo-400 font-semibold">ERP Portal</span>
        </div>
      </section>

      {/* Right Branded Showcase Panel */}
      <section className="hidden lg:flex flex-1 relative overflow-hidden items-center justify-center p-12 bg-[radial-gradient(ellipse_at_center,#1E1754_0%,#110D35_55%,#09081F_100%)]">
        {/* Subtle Concentric Orbital Rings */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-[340px] h-[340px] rounded-full border border-indigo-400/[0.08]" />
          <div className="absolute w-[520px] h-[520px] rounded-full border border-indigo-400/[0.06]" />
          <div className="absolute w-[720px] h-[720px] rounded-full border border-indigo-400/[0.04]" />
        </div>

        {/* Subtle Star Dots */}
        <span className="pointer-events-none absolute top-[18%] left-[22%] w-1 h-1 rounded-full bg-indigo-300/35" />
        <span className="pointer-events-none absolute top-[28%] right-[20%] w-1.5 h-1.5 rounded-full bg-indigo-300/25" />
        <span className="pointer-events-none absolute bottom-[24%] left-[18%] w-1.5 h-1.5 rounded-full bg-indigo-400/25" />
        <span className="pointer-events-none absolute bottom-[18%] right-[25%] w-1 h-1 rounded-full bg-indigo-200/35" />

        <div className="relative z-10 max-w-lg text-center flex flex-col items-center">
          {/* Glowing Center Emblem */}
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#3730A3]/75 to-[#1E1B4B]/90 border border-indigo-400/30 shadow-[0_0_55px_rgba(99,102,241,0.38)] flex items-center justify-center mb-7">
            <div className="w-14 h-14 rounded-xl border border-indigo-200/50 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold tracking-tight text-white leading-none">
                AT
              </span>
              <span className="text-[8px] font-semibold tracking-[0.18em] text-indigo-200 uppercase mt-1">
                ATCL ERP
              </span>
            </div>
          </div>

          <h2 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-tight">
            Your Professional
            <span className="block text-[#8E84FF]">ERP Portal</span>
          </h2>

          <p className="mt-4 text-sm text-indigo-100/70 leading-relaxed max-w-md">
            Manage inventory, purchases, sales, and complete double-entry accounting — all from one beautifully designed platform.
          </p>

          {/* Module Pill Badges */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            {FEATURE_PILLS.map((pill) => (
              <span
                key={pill}
                className="px-3.5 py-1 rounded-full text-xs font-medium text-indigo-100/85 bg-white/[0.06] border border-indigo-300/20 backdrop-blur-xs"
              >
                {pill}
              </span>
            ))}
          </div>

          {/* Indicator Dots */}
          <div className="mt-8 flex items-center justify-center gap-1.5" aria-hidden="true">
            <span className="w-5 h-1.5 rounded-full bg-[#7467FF]" />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300/30" />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300/30" />
          </div>
        </div>
      </section>
    </div>
  );
};
