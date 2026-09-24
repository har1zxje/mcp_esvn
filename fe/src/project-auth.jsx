import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import './project-auth.css';

const AuthContext = createContext(null);
export function projectFetch(input, init = {}) { return fetch(input, { ...init, credentials: 'include' }); }
const getSafeReturnTo = () => { const value = new URLSearchParams(window.location.search).get('returnTo'); return value && value.startsWith('/') && !value.startsWith('//') ? value : '/chat/new'; };

async function currentUser() {
  const response = await projectFetch('/api/me');
  if (response.status === 401) { const payload = await response.json().catch(() => ({})); const error = new Error(payload.code || 'AUTH_REQUIRED'); error.code = payload.code || 'AUTH_REQUIRED'; throw error; }
  if (!response.ok) throw new Error('AUTH_CHECK_FAILED');
  return response.json();
}

export function ProjectAuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });
  const [error, setError] = useState(new URLSearchParams(window.location.search).get('auth_error') || '');
  const bootstrap = useCallback(async () => { try { const session = await currentUser(); setState(session?.authenticated && session.user ? { status: 'authenticated', user: session.user } : { status: 'unauthenticated', user: null }); } catch (authError) { setError(authError.code === 'AUTH_SESSION_EXPIRED' ? 'Your session has expired. Please sign in again.' : ''); setState({ status: 'unauthenticated', user: null }); } }, []);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  const logout = useCallback(async () => { try { await projectFetch('/api/auth/logout', { method: 'POST' }); } finally { setState({ status: 'unauthenticated', user: null }); } }, []);
  const value = useMemo(() => ({ ...state, error, logout }), [state, error, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useProjectAuth() { return useContext(AuthContext); }

function GoogleIcon() { return <svg aria-hidden="true" className="project-login-google-icon" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.35 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z"/><path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.5Z"/><path fill="#FBBC05" d="M6.53 13.58A5.86 5.86 0 0 1 6.22 12c0-.55.1-1.09.31-1.58V7.89H3.28A9.5 9.5 0 0 0 2.25 12c0 1.48.35 2.88 1.03 4.11l3.25-2.53Z"/><path fill="#EA4335" d="M12 6.39c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 3.46 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 8.11 9.46 6.39 12 6.39Z"/></svg>; }
function EyeIcon({ hidden }) { return hidden ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.34 1-1.1 2.08-2.2 3.05M6.1 6.1C3.65 7.64 2.54 10.08 2.5 12c.2.58.77 1.55 1.7 2.5A10.3 10.3 0 0 0 12 19c1.16 0 2.25-.2 3.23-.56" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>; }

export function ProjectLogin() {
  const { error } = useProjectAuth(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [rememberMe, setRememberMe] = useState(false); const [showPassword, setShowPassword] = useState(false); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState(''); const [emailError, setEmailError] = useState(''); const returnTo = getSafeReturnTo(); const displayError = localError || error;
  const submit = async (event) => { event.preventDefault(); if (busy) return; if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setEmailError('Please enter a valid email address.'); return; } setEmailError(''); setLocalError(''); setBusy(true); try { const response = await projectFetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password, rememberMe }) }); await response.json().catch(() => ({})); if (!response.ok) throw new Error('Email or password is incorrect.'); window.location.assign(returnTo); } catch { setLocalError('Email or password is incorrect.'); } finally { setBusy(false); } };
  return <main className="project-login"><section className="project-login-card" aria-labelledby="project-login-title"><div className="project-login-brand" aria-hidden="true"><span className="project-login-brand-mark">âœ¦</span></div><header className="project-login-header"><h1 id="project-login-title">Internal Assistant</h1><p className="project-login-welcome">Welcome back</p><p>Sign in to continue to your account</p></header>{displayError && <div role="alert" aria-live="polite" className="project-login-error">{displayError}</div>}<form onSubmit={submit} className="project-login-form" noValidate><div className="project-login-field"><label htmlFor="project-email">Email</label><input id="project-email" name="email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} placeholder="name@company.com" autoComplete="email" aria-invalid={!!emailError} aria-describedby={emailError ? 'project-email-error' : undefined} required />{emailError && <span id="project-email-error" className="project-login-field-error">{emailError}</span>}</div><div className="project-login-field"><div className="project-login-label-row"><label htmlFor="project-password">Password</label><a href="mailto:it-support@company.com?subject=Internal%20Assistant%20password%20reset">Forgot password?</a></div><div className="project-login-password"><input id="project-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" className="project-login-eye" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><EyeIcon hidden={!showPassword} /></button></div></div><label className="project-login-remember"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> <span>Remember me</span></label><button type="submit" className="project-login-submit" disabled={busy || !email || !password}>{busy ? <><span className="project-login-spinner" aria-hidden="true" />Signing in...</> : 'Sign in'}</button></form><div className="project-login-divider"><span>OR</span></div><a className="project-login-google" href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`}><GoogleIcon />Continue with Google</a><p className="project-login-access">Don't have an account? <a href="/register">Create an account</a></p></section></main>;
}

export function ProjectRegister() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await projectFetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.code === 'AUTH_EMAIL_EXISTS' ? 'An account with this email already exists.' : 'Unable to create your account.');
      setSuccess('Your account is ready. Redirecting to chat...');
      window.location.assign('/chat/new');
    } catch (registerError) { setError(registerError.message || 'Unable to create your account.'); } finally { setBusy(false); }
  };

  return <main className="project-login"><section className="project-login-card" aria-labelledby="project-register-title"><div className="project-login-brand" aria-hidden="true"><span className="project-login-brand-mark">âœ¦</span></div><header className="project-login-header"><h1 id="project-register-title">Request access</h1><p className="project-login-welcome">Create your account</p><p>Use your work email to get started</p></header>{error && <div role="alert" aria-live="polite" className="project-login-error">{error}</div>}{success && <div role="status" aria-live="polite" className="project-login-success">{success}</div>}<form onSubmit={submit} className="project-login-form" noValidate><div className="project-login-field"><label htmlFor="project-register-email">Email</label><input id="project-register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="email" required /></div><div className="project-login-field"><label htmlFor="project-register-password">Password</label><input id="project-register-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div><button type="submit" className="project-login-submit" disabled={busy || !email || !password}>{busy ? <><span className="project-login-spinner" aria-hidden="true" />Creating account...</> : 'Create account'}</button></form><p className="project-login-access">Already have an account? <a href="/login">Sign in</a></p></section></main>;
}


