import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2/dist/sweetalert2.js';
import 'sweetalert2/dist/sweetalert2.css';
import { Camera as CameraIcon, CheckCircle2, Key, Mail, Shield } from 'lucide-react';

import GuidedFaceEnrollmentModal from './GuidedFaceEnrollmentModal';

const FACE_POSES = [
  { key: 'front', label: 'Straight' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEnrollmentModalOpen, setIsEnrollmentModalOpen] = useState(false);
  const [capturedReferences, setCapturedReferences] = useState({});
  const navigate = useNavigate();

  const completedReferenceCount = useMemo(
    () => FACE_POSES.filter((pose) => capturedReferences[pose.key]).length,
    [capturedReferences],
  );

  const handleSignup = async (event) => {
    event.preventDefault();

    if (completedReferenceCount !== FACE_POSES.length) {
      Swal.fire({
        icon: 'error',
        title: 'Face Enrollment Required',
        text: 'Capture straight, left, and right reference photos before signing up.',
        background: '#2a2a2a',
        color: '#fff',
        confirmButtonColor: '#646cff',
      });
      return;
    }

    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);
    formData.append('image_front', capturedReferences.front.blob, 'face-front.jpg');
    formData.append('image_left', capturedReferences.left.blob, 'face-left.jpg');
    formData.append('image_right', capturedReferences.right.blob, 'face-right.jpg');

    try {
      setLoading(true);
      setError('');

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/auth/signup`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Signup failed');
      }

      localStorage.setItem('userId', data.id);

      await Swal.fire({
        icon: 'success',
        title: 'Success!',
        text: data.message,
        background: '#2a2a2a',
        color: '#fff',
        confirmButtonColor: '#646cff',
      });

      navigate('/');
    } catch (signupError) {
      const message = signupError.message || 'Signup failed';
      setError(message);
      await Swal.fire({
        icon: 'error',
        title: 'Signup Failed',
        text: message,
        background: '#2a2a2a',
        color: '#fff',
        confirmButtonColor: '#646cff',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 p-4">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.12)]">
            <div className="bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-700 px-8 py-10 text-white">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
                <Shield className="h-8 w-8" />
              </div>
              <h1 className="mt-6 text-4xl font-bold">Student Sign Up</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-emerald-50/90">
                Create a stronger face enrollment profile with guided straight, left, and right reference captures.
              </p>

              <div className="mt-8 grid gap-3">
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="text-sm font-semibold">Automatic capture</p>
                  <p className="mt-1 text-sm text-emerald-50/80">
                    The camera captures each angle once your face is aligned and stable.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="text-sm font-semibold">Quality checks</p>
                  <p className="mt-1 text-sm text-emerald-50/80">
                    Blurry, dark, cropped, or badly angled images are rejected before signup.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="text-sm font-semibold">Better identity matching</p>
                  <p className="mt-1 text-sm text-emerald-50/80">
                    Front, left, and right references help reduce false mismatches during login and exams.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-8 py-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Enrollment Progress</p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-900">{completedReferenceCount}/3 references ready</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEnrollmentModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <CameraIcon className="h-4 w-4" />
                  {completedReferenceCount === 3 ? 'Retake References' : 'Start Guided Capture'}
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {FACE_POSES.map((pose) => {
                  const entry = capturedReferences[pose.key];
                  return (
                    <div
                      key={pose.key}
                      className={`overflow-hidden rounded-3xl border ${
                        entry ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{pose.label}</p>
                          <p className="text-xs text-slate-500">Reference pose</p>
                        </div>
                        {entry ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            ready
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500">
                            pending
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        {entry ? (
                          <img
                            src={entry.previewUrl}
                            alt={`${pose.label} face reference`}
                            className="h-36 w-full rounded-2xl object-cover"
                          />
                        ) : (
                          <div className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center text-sm text-slate-400">
                            Capture this angle in the guided camera flow
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)]">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-600">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900">Secure Account Setup</h2>
              <p className="mt-2 text-sm text-slate-500">
                Complete your account details, then use the guided camera flow to finish face enrollment.
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Mail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="email"
                    placeholder="student@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-slate-900 placeholder-slate-400 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    <Key className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    placeholder="Create a strong password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-slate-900 placeholder-slate-400 transition-all duration-200 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Face Enrollment</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Required: straight, left, and right references with automatic capture and quality checks.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEnrollmentModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800"
                  >
                    <CameraIcon className="h-4 w-4" />
                    Open Camera
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || completedReferenceCount !== FACE_POSES.length}
                className="mt-4 w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 font-semibold text-white shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating Account...
                  </span>
                ) : (
                  'Sign Up'
                )}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-500">
              <p>
                Already have an account?{' '}
                <button
                  onClick={() => navigate('/login')}
                  className="font-medium text-emerald-600 transition-colors hover:text-emerald-700 hover:underline"
                  type="button"
                >
                  Login
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>

      <GuidedFaceEnrollmentModal
        isOpen={isEnrollmentModalOpen}
        onClose={() => setIsEnrollmentModalOpen(false)}
        onComplete={(references) => {
          setCapturedReferences(references);
          setIsEnrollmentModalOpen(false);
          setError('');
        }}
      />
    </div>
  );
};

export default Signup;
