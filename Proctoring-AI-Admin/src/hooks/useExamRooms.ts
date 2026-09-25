import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import type { AdminLiveSession } from '../types/adminLiveMonitor';

export interface ExamRoom {
  exam_id: number;
  title: string;
  description: string | null;
  status: 'active' | 'upcoming' | 'ended' | 'inactive' | 'invalid';
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  question_count: number;
  attempt_count: number;
  monitor_key: string | null;
  exam_url: string | null;
  // live aggregates (from /admin/live merged in)
  active_count: number;
  critical_count: number;
  flagged_count: number;
  avg_compliance: number | null;
  sessions: AdminLiveSession[];
}

const POLL_MS = 8_000;

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSession(raw: Record<string, unknown>): AdminLiveSession {
  const status = String(raw.status || '').toLowerCase();
  return {
    id: toNumber(raw.id),
    session_id: raw.session_id == null ? null : toNumber(raw.session_id),
    exam_id: raw.exam_id == null ? null : toNumber(raw.exam_id),
    email: String(raw.email || ''),
    full_name: String(raw.full_name || 'Student'),
    status: (['active', 'completed', 'terminated'].includes(status) ? status : 'offline') as AdminLiveSession['status'],
    is_live: Boolean(raw.is_live),
    violation_count: toNumber(raw.violation_count),
    tier: (['Critical', 'Flagged', 'Watch', 'Safe'].includes(String(raw.tier || '')) ? raw.tier : 'Safe') as AdminLiveSession['tier'],
    score: toNumber(raw.score),
    total_marks: toNumber(raw.total_marks),
    progress: toNumber(raw.progress),
    compliance: toNullableNumber(raw.compliance),
    last_active: typeof raw.last_active === 'string' ? raw.last_active : null,
    exam_title: typeof raw.exam_title === 'string' ? raw.exam_title : null,
    duration_minutes: toNumber(raw.duration_minutes),
  };
}

export function useExamRooms() {
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [feedRes, liveRes] = await Promise.all([
        api.get('exam/admin/exams/live', { params: { limit: 50 } }),
        api.get('exam/admin/live'),
      ]);

      if (!mountedRef.current) return;

      const feedExams: Record<string, unknown>[] = Array.isArray(feedRes.data?.exams)
        ? feedRes.data.exams
        : [];
      const liveSessions: Record<string, unknown>[] = Array.isArray(liveRes.data?.sessions)
        ? liveRes.data.sessions
        : [];

      // Group sessions by exam_id (use student.id which carries exam_title for lookup)
      const sessionsByExam: Record<number, AdminLiveSession[]> = {};
      for (const raw of liveSessions) {
        const examId = toNumber(raw.exam_id ?? raw.examId ?? 0);
        if (!sessionsByExam[examId]) sessionsByExam[examId] = [];
        sessionsByExam[examId].push(normalizeSession(raw));
      }

      const nextRooms: ExamRoom[] = feedExams.map((exam) => {
        const examId = toNumber(exam.id);
        const sessionsForExam = sessionsByExam[examId] ?? [];
        const activeSessions = sessionsForExam.filter(s => s.status === 'active');
        const criticalCount = sessionsForExam.filter(s => s.tier === 'Critical').length;
        const flaggedCount = sessionsForExam.filter(s => s.tier === 'Flagged' || s.tier === 'Critical').length;
        const complianceVals = sessionsForExam
          .map(s => s.compliance)
          .filter((c): c is number => c !== null);
        const avgCompliance = complianceVals.length
          ? Math.round(complianceVals.reduce((a, b) => a + b, 0) / complianceVals.length)
          : null;

        return {
          exam_id: examId,
          title: String(exam.title || 'Untitled Exam'),
          description: typeof exam.description === 'string' ? exam.description : null,
          status: (exam.status as ExamRoom['status']) || 'inactive',
          start_time: typeof exam.start_time === 'string' ? exam.start_time : null,
          end_time: typeof exam.end_time === 'string' ? exam.end_time : null,
          duration_minutes: toNumber(exam.duration_minutes),
          question_count: toNumber(exam.question_count),
          attempt_count: toNumber(exam.attempt_count),
          monitor_key: typeof exam.monitor_key === 'string' ? exam.monitor_key : null,
          exam_url: typeof exam.exam_url === 'string' ? exam.exam_url : null,
          active_count: activeSessions.length,
          critical_count: criticalCount,
          flagged_count: flaggedCount,
          avg_compliance: avgCompliance,
          sessions: sessionsForExam,
        };
      });

      setRooms(nextRooms);
      setLastUpdated(feedRes.data?.generated_at ?? new Date().toISOString());
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError('Unable to load exam rooms. Retrying...');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { rooms, isLoading, error, lastUpdated, refresh };
}
