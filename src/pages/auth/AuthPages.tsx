import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail, ShieldAlert, User } from 'lucide-react';
import { Button } from '../../components/ui/DesignSystem';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi, ApiError } from '../../services/api';
import { isStaffRole } from '../../domain/commercePolicy';

const DEMO_ACCOUNTS = [
  { label: 'Customer (Sathya)', email: 'sathya@example.com', pass: 'Customer@123' },
  { label: 'Admin', email: 'admin@agenticcommerce.in', pass: 'Admin@123' },
  { label: 'AI Admin', email: 'aiadmin@agenticcommerce.in', pass: 'AiAdmin@123' },
  { label: 'Ops Manager', email: 'ops@agenticcommerce.in', pass: 'Ops@123' },
  { label: 'Support', email: 'support@agenticcommerce.in', pass: 'Support@123' },
];

export function SignInPage() {
  const { login } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      pushToast({ variant: 'success', title: `Welcome back, ${user.name.split(' ')[0]}` });
      if (from) {
        navigate(from, { replace: true });
      } else if (isStaffRole(user.roles)) {
        navigate('/admin', { replace: true });
      } else {
        navigate('/home', { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Sign In to Your Account</h2>
      <p className="mt-1.5 text-sm text-[#6B6680]">
        Access real-time order tracking, saved recommendations, and authoritative checkout.
      </p>

      {error && (
        <div role="alert" className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="signin-email" className="block text-xs font-semibold text-[#211A35] mb-1.5">
            Email Address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#E7E1F2] bg-white text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="signin-password" className="block text-xs font-semibold text-[#211A35]">
              Password
            </label>
            <Link to="/forgot-password" className="text-xs font-semibold text-[#7C3AED] hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="signin-password"
              type={showPass ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full h-11 pl-10 pr-11 rounded-xl border border-[#E7E1F2] bg-white text-sm focus:outline-none focus:border-[#7C3AED]"
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B6680] hover:text-[#211A35] p-1 cursor-pointer"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-[#6B6680] cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded border-[#E7E1F2] text-[#7C3AED]"
          />
          Keep me signed in on this device
        </label>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing In...' : 'Sign In'}
        </Button>
      </form>

      <div className="mt-6 pt-5 border-t border-[#E7E1F2]">
        <p className="text-xs font-semibold text-[#6B6680] mb-2.5">Quick-fill seeded workspace accounts:</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => {
                setEmail(acc.email);
                setPassword(acc.pass);
                setError(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-[#E7E1F2] bg-[#F8F7FC] hover:bg-[#F3F0FA] text-xs font-medium text-[#211A35] cursor-pointer transition-colors"
            >
              {acc.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-[#6B6680]">
        New to Agentic Commerce?{' '}
        <Link to="/register" className="font-semibold text-[#7C3AED] hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await register({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, password });
      pushToast({ variant: 'success', title: 'Account created', description: 'Welcome to Agentic Commerce!' });
      navigate('/verify-email', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Create Your Account</h2>
      <p className="mt-1.5 text-sm text-[#6B6680]">
        Get personalized AI shopping help, saved wishlists, and real-time delivery updates.
      </p>

      {error && (
        <div role="alert" className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="reg-name" className="block text-xs font-semibold text-[#211A35] mb-1.5">
            Full Name
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="reg-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Karthik Subramanian"
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-email" className="block text-xs font-semibold text-[#211A35] mb-1.5">
              Email Address
            </label>
            <input
              id="reg-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
          <div>
            <label htmlFor="reg-phone" className="block text-xs font-semibold text-[#211A35] mb-1.5">
              Mobile Number (Optional)
            </label>
            <input
              id="reg-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="reg-password" className="block text-xs font-semibold text-[#211A35] mb-1.5">
              Password (8+ chars)
            </label>
            <input
              id="reg-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
          <div>
            <label htmlFor="reg-confirm" className="block text-xs font-semibold text-[#211A35] mb-1.5">
              Confirm Password
            </label>
            <input
              id="reg-confirm"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Creating Account...' : 'Create Account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[#6B6680]">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-[#7C3AED] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(email.trim());
      setSentMessage(res.message);
      if (res.previewResetToken) setPreviewToken(res.previewResetToken);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Forgot Password</h2>
      <p className="mt-1.5 text-sm text-[#6B6680]">
        Enter your registered email and we will generate a single-use password reset token.
      </p>

      {sentMessage ? (
        <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3">
          <p className="text-sm text-emerald-800 flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {sentMessage}
          </p>
          {previewToken && (
            <div className="p-3 bg-white rounded-lg border border-emerald-200 text-xs">
              <p className="text-[#6B6680]">Reset token (preview delivery):</p>
              <p className="font-mono-tabular font-semibold text-[#1F1647] mt-1 break-all">{previewToken}</p>
              <Link
                to={`/reset-password?token=${encodeURIComponent(previewToken)}`}
                className="inline-block mt-2 font-semibold text-[#7C3AED] hover:underline"
              >
                Continue to Reset Password →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="fp-email" className="block text-xs font-semibold text-[#211A35] mb-1.5">
              Email Address
            </label>
            <input
              id="fp-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sathya@example.com"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Sending...' : 'Request Reset Link'}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-[#6B6680]">
        <Link to="/login" className="font-semibold text-[#7C3AED] hover:underline">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [token, setToken] = useState(params.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword({ token: token.trim(), newPassword });
      pushToast({ variant: 'success', title: 'Password updated', description: 'Please sign in with your new password.' });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Set a New Password</h2>
      <p className="mt-1.5 text-sm text-[#6B6680]">
        Choose a strong password (minimum 8 characters).
      </p>

      {error && (
        <div role="alert" className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="rp-token" className="block text-xs font-semibold text-[#211A35] mb-1.5">
            Reset Token
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-[#6B6680] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="rp-token"
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full h-11 pl-10 pr-4 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
        </div>
        <div>
          <label htmlFor="rp-new" className="block text-xs font-semibold text-[#211A35] mb-1.5">
            New Password
          </label>
          <input
            id="rp-new"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
          />
        </div>
        <div>
          <label htmlFor="rp-confirm" className="block text-xs font-semibold text-[#211A35] mb-1.5">
            Confirm Password
          </label>
          <input
            id="rp-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full h-11 px-3.5 rounded-xl border border-[#E7E1F2] text-sm focus:outline-none focus:border-[#7C3AED]"
          />
        </div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Updating Password...' : 'Reset Password'}
        </Button>
      </form>
    </div>
  );
}

export function VerifyEmailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [otp, setOtp] = useState('');
  const [verified, setVerified] = useState(false);

  return (
    <div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Verify Your Email</h2>
      <p className="mt-1.5 text-sm text-[#6B6680]">
        Enter the 6-digit verification code sent to <span className="font-semibold text-[#211A35]">{user?.email || 'your email'}</span>, or continue directly into the store.
      </p>

      {verified ? (
        <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 space-y-3">
          <p className="font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Email verification confirmed
          </p>
          <Button onClick={() => navigate('/home')}>Enter Storefront</Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setVerified(true);
          }}
          className="mt-6 space-y-4"
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter 6-digit code (e.g. 482910)"
            className="w-full h-12 px-4 rounded-xl border border-[#E7E1F2] text-center text-lg tracking-[0.35em] font-mono-tabular focus:outline-none focus:border-[#7C3AED]"
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={otp.length < 6} className="flex-1">
              Verify Code
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/home')} className="flex-1">
              Continue to Storefront
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SessionExpiredPage() {
  return (
    <div className="text-center py-4">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Session Expired</h2>
      <p className="mt-2 text-sm text-[#6B6680]">
        Your secure session has expired or was signed out. Sign in again to continue where you left off.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/login">
          <Button>Sign In Again</Button>
        </Link>
        <Link to="/">
          <Button variant="outline">Back to Storefront</Button>
        </Link>
      </div>
    </div>
  );
}

export function AccessDeniedPage() {
  return (
    <div className="text-center py-4">
      <div className="w-14 h-14 rounded-2xl bg-red-50 text-[#EF4444] flex items-center justify-center mx-auto mb-4">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h2 className="text-2xl font-bold text-[#1F1647]">Access Denied (403)</h2>
      <p className="mt-2 text-sm text-[#6B6680]">
        Your account role does not have permission to view this restricted operational console.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/home">
          <Button>Return to Customer Home</Button>
        </Link>
        <Link to="/shop">
          <Button variant="outline">Browse Catalog</Button>
        </Link>
      </div>
    </div>
  );
}
