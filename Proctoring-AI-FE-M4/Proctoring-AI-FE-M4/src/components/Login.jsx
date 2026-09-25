import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/authService';
import GuidedFaceEnrollmentModal from './GuidedFaceEnrollmentModal';
import { Shield, Mail, Key, Eye, EyeOff, ArrowRight, CheckCircle, Lock, RefreshCw } from 'lucide-react';

/* ─── helpers ─── */
const isResetRequired = (msg = '') =>
  msg.toLowerCase().includes('password reset required') ||
  msg.toLowerCase().includes('must reset') ||
  msg.toLowerCase().includes('temporary password');

const strengthScore = (pw) => {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
};

const StrengthBar = ({ password }) => {
  const score = strengthScore(password);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
  if (!password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            height: 4, flex: 1, borderRadius: 99,
            background: i <= score ? colors[score] : '#e2e8f0',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      {score > 0 && (
        <p style={{ fontSize: 11, fontWeight: 600, color: colors[score], marginTop: 4 }}>
          {labels[score]} password
        </p>
      )}
    </div>
  );
};

const PasswordInput = ({ value, onChange, placeholder, id, autoComplete }) => {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
        <Key size={16} />
      </div>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete || 'current-password'}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-11 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-400 focus:bg-white"
        required
      />
      <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
};

/* ═══ Login component (no motion/react — uses CSS transitions only) ═══ */
const Login = () => {
  const [searchParams] = useSearchParams();
  const examIdFromUrl = searchParams.get('examId');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [faceOpen, setFaceOpen] = useState(false);
  const [loginAttemptId, setLoginAttemptId] = useState('');
  const [livenessChallengeId, setLivenessChallengeId] = useState('');
  const [poseOrder, setPoseOrder] = useState(null);
  const [step, setStep] = useState('idle');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const newPwRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token')?.trim();
    const userId = localStorage.getItem('userId')?.trim();
    const ltiPending = localStorage.getItem('ltiIdentityPending') === '1';
    if (!token || !userId || token === 'undefined' || token === 'null') return;
    if (ltiPending) {
      navigate('/verify-identity', { replace: true });
      return;
    }
    navigate(examIdFromUrl ? `/exam/${examIdFromUrl}` : '/exam', { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showReset) setTimeout(() => newPwRef.current?.focus(), 150);
  }, [showReset]);

  /* Step 1 — check credentials */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!email.trim() || !password) { setError('Email and password are required.'); return; }
    setStep('checking');
    try {
      const attempt = await authService.createLoginAttempt({ email: email.trim(), password });
      setLoginAttemptId(attempt.attempt_id || '');
      const challenge = await authService.createLoginLivenessChallenge({
        email: email.trim(),
        loginAttemptId: attempt.attempt_id || '',
      });
      setLivenessChallengeId(challenge.challenge_id || '');
      setPoseOrder(Array.isArray(challenge.pose_order) ? challenge.pose_order : null);
      setStep('idle');
      setFaceOpen(true);
    } catch (err) {
      const msg = err.message || '';
      if (isResetRequired(msg)) { setStep('idle'); setShowReset(true); setError(''); return; }
      setStep('idle');
      setError(msg || 'Incorrect email or password.');
    }
  };

  /* Step 2 — reset password */
  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    if (!newPassword || !confirmPassword) { setError('Both password fields are required.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (strengthScore(newPassword) < 2) { setError('Choose a stronger password (min 8 chars with a number or uppercase).'); return; }
    setStep('resetting');
    try {
      await authService.resetInitialPassword({ email: email.trim(), temporaryPassword: password, newPassword });
      setPassword(newPassword);
      setNewPassword(''); setConfirmPassword('');
      setShowReset(false);
      setSuccess('Password set! Now complete the quick face check.');
      setStep('idle');
      const attempt = await authService.createLoginAttempt({ email: email.trim(), password: newPassword });
      setLoginAttemptId(attempt.attempt_id || '');
      const challenge = await authService.createLoginLivenessChallenge({
        email: email.trim(),
        loginAttemptId: attempt.attempt_id || '',
      });
      setLivenessChallengeId(challenge.challenge_id || '');
      setPoseOrder(Array.isArray(challenge.pose_order) ? challenge.pose_order : null);
      setTimeout(() => setFaceOpen(true), 800);
    } catch (err) {
      setStep('idle');
      setError(err.message || 'Reset failed. Check your temporary password and try again.');
    }
  };

  /* Step 3 — face verification */
  const handleFaceComplete = async (references) => {
    // Capture the blob reference BEFORE closing the modal, otherwise
    // React cleanup may garbage-collect it when the modal unmounts.
    const frontBlob = references.front?.blob;
    if (!frontBlob) {
      setFaceOpen(false);
      setStep('idle');
      setError('Face photo was not captured. Please try again.');
      return;
    }

    setFaceOpen(false);
    setStep('verifying');
    setError('');
    try {
      await authService.loginWithPasswordAndFace({
        email: email.trim(),
        password,
        loginAttemptId,
        livenessChallengeId,
        imageFront: frontBlob,
      });
      setStep('done');
      setTimeout(() => navigate(examIdFromUrl ? `/exam/${examIdFromUrl}` : '/exam', { replace: true }), 600);
    } catch (err) {
      setStep('idle');
      setLoginAttemptId('');
      setLivenessChallengeId('');
      setPoseOrder(null);
      setError(err.message || 'Face verification failed. Please try again.');
    }
  };

  const isLoading = ['checking', 'resetting', 'verifying', 'done'].includes(step);

  /* ─── step pill helper ─── */
  const StepPill = ({ n, label, done }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: done ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.1)',
      border: `1px solid ${done ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.2)'}`,
      color: done ? '#059669' : '#94a3b8',
      transition: 'all 0.3s',
    }}>
      {done
        ? <CheckCircle size={12} />
        : <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid currentColor', display: 'inline-block' }} />}
      {n} {label}
    </span>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      <style>{`
        .login-card { animation: slideUp 0.35s ease-out; }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        .login-input:focus { border-color: #34d399; ring: 2px rgba(52,211,153,0.2); }
        .panel-enter { animation: panelIn 0.22s ease-out; }
        @keyframes panelIn { from { opacity:0; transform:translateX(12px); } to { opacity:1; transform:translateX(0); } }
        .login-btn { transition: transform 0.15s, box-shadow 0.15s; }
        .login-btn:hover:not(:disabled) { transform: scale(1.01); }
        .login-btn:active:not(:disabled) { transform: scale(0.98); }
        .err-banner { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div className="login-card w-full max-w-md rounded-3xl shadow-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)' }}>
        {/* top accent */}
        <div style={{ height: 5, background: 'linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6)' }} />

        <div style={{ padding: '32px 32px 36px' }}>
          {/* logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 8px 24px rgba(16,185,129,0.35)' }}>
              <Shield size={28} color="white" />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: 0 }}>
              {step === 'done' ? 'Identity Verified ✓' : 'Secure Exam Login'}
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 6, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
              {showReset ? 'Set your permanent password to get started.'
                : examIdFromUrl ? `Logging into Exam #${examIdFromUrl}`
                : 'Access your proctored exam portal'}
            </p>
          </div>

          {/* step pills */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
            <StepPill n="1" label="Credentials" done={showReset || faceOpen || step === 'verifying' || step === 'done'} />
            <StepPill n="2" label="Face ID" done={step === 'verifying' || step === 'done'} />
            <StepPill n="3" label="Enter Exam" done={step === 'done'} />
          </div>

          {/* banners */}
          {error && (
            <div className="err-banner" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 12, background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!error && success && (
            <div className="err-banner" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={15} /> {success}
            </div>
          )}

          {/* ── MAIN FORM ── */}
          {!showReset ? (
            <form key="login" className="panel-enter" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 6 }}>Email Address</label>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}><Mail size={16} /></div>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="student@university.edu" autoComplete="email" required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-400 focus:bg-white" />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 6 }}>Password</label>
                <PasswordInput id="login-password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Your password or temporary password" />
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                  Use your password or admin-issued temporary password — we'll guide you.
                </p>
              </div>

              {/* username hidden for accessibility */}
              <input type="text" name="username" autoComplete="username" value={email} onChange={() => {}} style={{ display: 'none' }} readOnly />

              <button type="submit" disabled={isLoading} className="login-btn w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white"
                style={{ background: isLoading ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)', boxShadow: isLoading ? 'none' : '0 6px 20px rgba(16,185,129,0.35)', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer' }}>
                {isLoading
                  ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> {step === 'checking' ? 'Checking…' : step === 'verifying' ? 'Verifying…' : step === 'done' ? 'Entering exam…' : 'Loading…'}</>
                  : <>Continue to Verification <ArrowRight size={16} /></>}
              </button>

              <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                Access is granted by your exam administrator. Contact them if you can't log in.
              </p>
            </form>
          ) : (
            /* ── RESET PANEL ── */
            <div key="reset" className="panel-enter">
              <div style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 14, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', gap: 10 }}>
                <Lock size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#92400e', margin: 0 }}>First-time access detected</p>
                  <p style={{ fontSize: 11, color: '#b45309', margin: '4px 0 0', lineHeight: 1.5 }}>
                    You're using a temporary password. Create your own below — you won't need to re-enter the old one.
                  </p>
                </div>
              </div>

              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 6 }}>New Password</label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}><Key size={16} /></div>
                    <input ref={newPwRef} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="Create a strong password" autoComplete="new-password" required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-400 focus:bg-white" />
                  </div>
                  <StrengthBar password={newPassword} />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 6 }}>Confirm Password</label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}><Key size={16} /></div>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password" autoComplete="new-password" required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-400 focus:bg-white" />
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && <p style={{ fontSize: 11, color: '#e11d48', marginTop: 4, fontWeight: 600 }}>Passwords don't match</p>}
                  {confirmPassword && newPassword === confirmPassword && <p style={{ fontSize: 11, color: '#16a34a', marginTop: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={12} /> Passwords match</p>}
                </div>

                <button type="submit" disabled={isLoading} className="login-btn w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white"
                  style={{ background: isLoading ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)', boxShadow: isLoading ? 'none' : '0 6px 20px rgba(16,185,129,0.35)', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer' }}>
                  {step === 'resetting'
                    ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Setting password…</>
                    : <><CheckCircle size={16} /> Set Password & Continue</>}
                </button>

                <button type="button" onClick={() => { setShowReset(false); setError(''); setNewPassword(''); setConfirmPassword(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4 }}>
                  <RefreshCw size={13} /> Try a different account
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <GuidedFaceEnrollmentModal
        isOpen={faceOpen}
        onClose={() => {
          setFaceOpen(false);
          setStep('idle');
          setLoginAttemptId('');
          setLivenessChallengeId('');
          setPoseOrder(null);
        }}
        onComplete={handleFaceComplete}
        badgeLabel="Identity Verification"
        title="Look straight at the camera"
        description="Face the camera directly with good lighting. The photo will capture automatically."
        variant="login"
        poseOrder={poseOrder}
      />
    </div>
  );
};

export default Login;
