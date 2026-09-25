import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import GuidedFaceEnrollmentModal from './GuidedFaceEnrollmentModal';
import { Shield, CheckCircle } from 'lucide-react';

/**
 * LTI (and similar) students land here with a JWT but must bind face references before /exam.
 */
const VerifyIdentity = () => {
  const navigate = useNavigate();
  const [faceOpen, setFaceOpen] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState('idle');
  const [livenessChallengeId, setLivenessChallengeId] = useState('');
  const [poseOrder, setPoseOrder] = useState(null);

  const ensureChallenge = async () => {
    if (livenessChallengeId) return;
    const challenge = await authService.createLtiLivenessChallenge();
    setLivenessChallengeId(challenge.challenge_id || '');
    setPoseOrder(Array.isArray(challenge.pose_order) ? challenge.pose_order : null);
  };

  useEffect(() => {
    if (!faceOpen) return;
    // Fire-and-forget: modal will stay open; errors show when submit is attempted.
    void ensureChallenge();
  }, [faceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleComplete = async (references) => {
    setFaceOpen(false);
    setStep('verifying');
    setError('');
    try {
      await authService.completeLtiFaceBind({
        imageFront: references.front?.blob,
        imageLeft: references.left?.blob,
        imageRight: references.right?.blob,
        livenessChallengeId,
      });
      localStorage.removeItem('ltiIdentityPending');
      setStep('done');
      setTimeout(() => navigate('/exam', { replace: true }), 600);
    } catch (e) {
      setStep('idle');
      setError(e.message || 'Face verification failed. Please try again.');
      setLivenessChallengeId('');
      setPoseOrder(null);
      setFaceOpen(true);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    }}
    >
      <div className="w-full max-w-md rounded-3xl shadow-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)' }}>
        <div style={{ height: 5, background: 'linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6)' }} />
        <div style={{ padding: '28px 28px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14, background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 8px 24px rgba(16,185,129,0.35)',
            }}
            >
              <Shield size={26} color="white" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', margin: 0 }}>
              {step === 'done' ? 'Verified' : 'Verify your identity'}
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
              Your LMS login succeeded. Complete a quick face check to access your exams.
            </p>
          </div>

          {error && (
            <div style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 12, background: '#fff1f2',
              border: '1px solid #fecdd3', color: '#e11d48', fontSize: 13,
            }}
            >
              {error}
            </div>
          )}

          {!faceOpen && step !== 'verifying' && step !== 'done' && (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Camera closed — resume to continue.</p>
              <button
                type="button"
                onClick={() => { setError(''); setFaceOpen(true); }}
                className="w-full rounded-xl py-3 text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', cursor: 'pointer' }}
              >
                Resume face check
              </button>
            </div>
          )}

          {step === 'verifying' && (
            <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>Verifying…</p>
          )}
          {step === 'done' && (
            <p style={{ textAlign: 'center', fontSize: 13, color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <CheckCircle size={16} /> Redirecting…
            </p>
          )}
        </div>
      </div>

      <GuidedFaceEnrollmentModal
        isOpen={faceOpen}
        onClose={() => { setFaceOpen(false); }}
        onComplete={handleComplete}
        badgeLabel="LTI identity"
        title="Quick face check"
        description="Look straight, then slightly left and right."
        variant="login"
        poseOrder={poseOrder}
      />
    </div>
  );
};

export default VerifyIdentity;
