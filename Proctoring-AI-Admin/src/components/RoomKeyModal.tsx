import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { KeyRound, X, ShieldAlert, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';

interface RoomKeyModalProps {
  examId: number;
  examTitle: string;
  onSuccess: () => void;
  onClose: () => void;
}

const SESSION_KEY = (examId: number) => `exam-room-unlocked-${examId}`;

export function isRoomUnlocked(examId: number): boolean {
  try { return sessionStorage.getItem(SESSION_KEY(examId)) === '1'; } catch { return false; }
}

function setRoomUnlocked(examId: number) {
  try { sessionStorage.setItem(SESSION_KEY(examId), '1'); } catch { /* ignore */ }
}

export function RoomKeyModal({ examId, examTitle, onSuccess, onClose }: RoomKeyModalProps) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  const handleKeyInput = (raw: string) => {
    // Auto-format: uppercase, strip non-alphanum except dash, insert "MK-" prefix
    const stripped = raw.replace(/[^A-Z0-9a-z]/gi, '').toUpperCase().slice(0, 6);
    if (stripped.length <= 2) setKey(stripped);
    else setKey('MK-' + stripped.slice(2));
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleVerify = async () => {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) { setError('Please enter the room key.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await api.post('exam/admin/live/verify-room', { exam_id: examId, monitor_key: trimmed });
      if (res.data?.valid) {
        setRoomUnlocked(examId);
        onSuccess();
      } else {
        setError('Incorrect room key. Please try again.');
        triggerShake();
        setKey('');
        inputRef.current?.focus();
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Verification failed. Please try again.';
      setError(msg);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleVerify();
    if (e.key === 'Escape') onClose();
  };

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.88, y: 20 }}
          animate={shake ? { x: [-8, 8, -8, 8, -5, 5, 0] } : { opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.88, y: 20 }}
          transition={shake ? { duration: 0.5 } : { type: 'spring', damping: 22, stiffness: 280 }}
          className="relative w-full max-w-md overflow-hidden rounded-3xl"
          style={{
            background: 'linear-gradient(135deg, rgba(15,20,40,0.98), rgba(10,15,30,0.99))',
            border: '1px solid rgba(99,102,241,0.3)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(99,102,241,0.1)',
          }}
        >
          {/* Corner glow */}
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)', transform: 'translate(30%,-30%)' }} />

          {/* Close btn */}
          <button onClick={onClose}
            className="absolute top-4 right-4 h-8 w-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-white transition-colors z-10"
            style={{ background: 'rgba(255,255,255,0.05)' }}>
            <X className="h-4 w-4" />
          </button>

          <div className="p-8">
            {/* Icon header */}
            <div className="flex flex-col items-center mb-7">
              <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4 relative"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.15))', border: '1px solid rgba(99,102,241,0.35)', boxShadow: '0 0 30px rgba(99,102,241,0.3)' }}>
                <Lock className="h-8 w-8 text-violet-400" />
                <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center"
                  style={{ background: '#ef4444', border: '2px solid rgba(10,15,30,0.99)' }}>
                  <span className="text-[8px] font-black text-white">!</span>
                </div>
              </div>
              <h2 className="text-xl font-black text-white text-center mb-1">Room Access Required</h2>
              <p className="text-sm text-slate-400 text-center leading-relaxed max-w-xs">
                Enter the monitor key to access
              </p>
              <p className="text-sm font-bold text-violet-400 text-center mt-1 max-w-xs truncate px-4">
                "{examTitle}"
              </p>
            </div>

            {/* Info banner */}
            <div className="flex items-start gap-3 rounded-2xl p-3.5 mb-6"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <ShieldAlert className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-amber-300 leading-relaxed">
                This key was generated when the exam was created. Find it in the Exam Creator's publish confirmation or the exam card.
              </p>
            </div>

            {/* Key input */}
            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Monitor Key</label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={e => handleKeyInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="MK-XXXX"
                  maxLength={7}
                  className="w-full rounded-2xl pl-10 pr-12 py-4 text-center text-lg font-black tracking-[0.3em] text-white placeholder-slate-700 focus:outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: error ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    boxShadow: error ? '0 0 0 3px rgba(239,68,68,0.1)' : 'none',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                />
                <button onClick={() => setShowKey(!showKey)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300 transition-colors">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="text-xs font-semibold text-rose-400 text-center">
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Verify button */}
            <motion.button
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.97 }}
              onClick={() => void handleVerify()}
              disabled={loading || !key.trim()}
              className="mt-6 w-full rounded-2xl py-4 text-base font-black text-white transition-all duration-200 flex items-center justify-center gap-2"
              style={{
                background: loading || !key.trim()
                  ? 'rgba(99,102,241,0.3)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                boxShadow: !loading && key.trim() ? '0 8px 30px rgba(99,102,241,0.5)' : 'none',
                cursor: loading || !key.trim() ? 'not-allowed' : 'pointer',
              }}>
              {loading ? (
                <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</>
              ) : (
                <><KeyRound className="h-4 w-4" /> Enter Room</>
              )}
            </motion.button>

            <p className="text-center text-xs text-slate-700 mt-4">
              Access is remembered for this browser session
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
