import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { authService } from '../services/authService';
import { examService } from '../services/examService';
import { rememberDashboardExamEntry } from '../app/utils/lobbyProgress';
import { formatServerDateTime, toTimestampMs } from '../utils/timeUtils';

const statusStyles = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  upcoming: 'border-blue-200 bg-blue-50 text-blue-700',
  ended: 'border-slate-200 bg-slate-100 text-slate-600',
};

const statusPriority = {
  active: 0,
  upcoming: 1,
  ended: 2,
};

const ExamLobbyHome = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lastOpenedExamId = localStorage.getItem('examId');

  const loadDashboard = async () => {
    setLoading(true);
    setError('');

    try {
      const [profile, availableExams] = await Promise.all([
        authService.getUserProfile(),
        examService.getAvailableExams(),
      ]);

      setUser(profile);
      setExams(availableExams);
    } catch (err) {
      console.error('Failed to load exam dashboard:', err);
      if (err?.code === 'AUTH_EXPIRED') {
        navigate('/login', { replace: true });
        return;
      }
      if (err?.code === 'NETWORK_ERROR') {
        setError('Network issue detected. Please check your connection and retry.');
        return;
      }
      setError(err?.message || 'Unable to load available exams right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const examStats = useMemo(() => ({
    active: exams.filter((exam) => exam.status === 'active').length,
    upcoming: exams.filter((exam) => exam.status === 'upcoming').length,
    completed: exams.filter(
      (exam) => ['completed', 'terminated'].includes(exam.lastSessionStatus),
    ).length,
  }), [exams]);

  const orderedExams = useMemo(() => [...exams].sort((a, b) => {
    // Always show exams the student can join right now at the top.
    if (a.canJoin !== b.canJoin) {
      return a.canJoin ? -1 : 1;
    }

    const aStatus = statusPriority[a.status] ?? 99;
    const bStatus = statusPriority[b.status] ?? 99;
    if (aStatus !== bStatus) {
      return aStatus - bStatus;
    }

    const aStart = toTimestampMs(a.start_time);
    const bStart = toTimestampMs(b.start_time);
    return aStart - bStart;
  }), [exams]);

  const getActionMessage = (exam) => {
    if (exam.actionMessage) {
      return exam.actionMessage;
    }

    if (exam.status === 'upcoming') {
      return `Available from ${formatServerDateTime(exam.start_time, 'en-IN')}`;
    }

    if (exam.status === 'ended') {
      return `Exam window closed at ${formatServerDateTime(exam.end_time, 'en-IN')}`;
    }

    return exam.actionMessage;
  };

  const handleOpenExam = (examId) => {
    rememberDashboardExamEntry(examId);
    localStorage.setItem('examId', String(examId));
    navigate(`/exam/${examId}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-white/5 shadow-2xl shadow-slate-950/40 backdrop-blur">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="relative overflow-hidden border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.14),_transparent_36%)]" />
              <div className="relative">
                <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                  <ShieldCheck className="h-4 w-4" />
                  Secure student exam workspace
                </div>

                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  {user?.full_name ? `Welcome back, ${user.full_name}` : 'Welcome back'}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Choose an exam, complete the pre-checks, and start the monitored session from one place.
                  This replaces the old generic lobby so students always enter a real exam flow.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Active</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{examStats.active}</p>
                    <p className="mt-1 text-sm text-slate-400">Ready to join now</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Upcoming</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{examStats.upcoming}</p>
                    <p className="mt-1 text-sm text-slate-400">Scheduled later</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Previous Attempts</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{examStats.completed}</p>
                    <p className="mt-1 text-sm text-slate-400">Completed or closed</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="p-8 lg:p-10">
              <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-6">
                <p className="text-sm font-medium text-slate-200">Before you start</p>
                <div className="mt-5 space-y-4 text-sm text-slate-300">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                    <span>Keep your exam browser tab open and your webcam unobstructed.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                    <span>Complete system and network checks before entering the active session.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                    <span>Use the exam card action button to continue the correct lobby for that exam.</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <section className="mt-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">Available exams</h2>
              <p className="mt-1 text-sm text-slate-400">
                Active exams can be joined immediately. Upcoming exams will unlock automatically at their start time.
              </p>
            </div>
            <button
              type="button"
              onClick={loadDashboard}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          {loading && (
            <div className="flex min-h-[220px] items-center justify-center rounded-[28px] border border-white/10 bg-white/5">
              <div className="flex items-center gap-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading your exams...
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-[28px] border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Unable to load exam dashboard</p>
                  <p className="mt-1 text-sm text-rose-100/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && exams.length === 0 && (
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 text-center">
              <h3 className="text-xl font-semibold text-white">No exams available right now</h3>
              <p className="mt-2 text-sm text-slate-400">
                Once an administrator creates an active exam window, it will appear here automatically after login.
              </p>
            </div>
          )}

          {!loading && !error && exams.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-2">
              {orderedExams.map((exam) => (
                <article
                  key={exam.id}
                  className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-xl shadow-slate-950/20"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize ${statusStyles[exam.status] || statusStyles.ended}`}>
                        {exam.status}
                      </div>
                      <h3 className="mt-4 text-xl font-semibold text-white">{exam.title}</h3>
                      <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-400">
                        {exam.description || 'Secure AI-proctored exam session with lobby checks before the monitored assessment begins.'}
                      </p>
                    </div>
                    {String(exam.id) === String(lastOpenedExamId) && (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                        Last opened
                      </span>
                    )}
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        Duration
                      </div>
                      <p className="mt-2 text-lg font-semibold text-white">{exam.duration_minutes} minutes</p>
                      <p className="mt-1 text-xs text-slate-500">{exam.questionCount} questions</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Window
                      </div>
                      <p className="mt-2 text-sm font-medium text-white">{formatServerDateTime(exam.start_time, 'en-IN')}</p>
                      <p className="mt-1 text-xs text-slate-500">Ends {formatServerDateTime(exam.end_time, 'en-IN')}</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-sm text-slate-300">{getActionMessage(exam)}</p>
                    {exam.lastSessionStatus && (
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                        Last session status: {exam.lastSessionStatus}
                      </p>
                    )}
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={() => handleOpenExam(exam.id)}
                      disabled={!exam.canJoin}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition ${
                        exam.canJoin
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                          : 'cursor-not-allowed bg-slate-800 text-slate-500'
                      }`}
                    >
                      {exam.canJoin ? 'Continue to Exam Lobby' : 'Unavailable'}
                      {exam.canJoin && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ExamLobbyHome;
