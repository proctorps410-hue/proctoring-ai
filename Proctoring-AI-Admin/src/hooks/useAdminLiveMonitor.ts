import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import type {
  AdminConnectionState,
  AdminLivePayload,
  AdminLiveSession,
  AdminLiveStats,
  AdminRiskTier,
  AdminSessionStatus,
} from '../types/adminLiveMonitor';

const FALLBACK_STATS: AdminLiveStats = {
  active_students: 0,
  red_flags: 0,
  avg_compliance: null,
  total_students: 0,
  live_connections: 0,
  system_status: 'offline',
};

const EMPTY_PAYLOAD: AdminLivePayload = {
  generated_at: null,
  sessions: [],
  stats: FALLBACK_STATS,
};

const WS_POLL_FALLBACK_MS = 6000;
const WS_HEALTH_RESYNC_MS = 30000;
const WS_KEEPALIVE_MS = 15000;

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (value: unknown): AdminSessionStatus => {
  const status = String(value || '').toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'completed') return 'completed';
  if (status === 'terminated') return 'terminated';
  return 'offline';
};

const normalizeTier = (value: unknown): AdminRiskTier => {
  const tier = String(value || '').toLowerCase();
  if (tier === 'critical') return 'Critical';
  if (tier === 'flagged') return 'Flagged';
  if (tier === 'watch') return 'Watch';
  return 'Safe';
};

const normalizeSession = (raw: Record<string, unknown>): AdminLiveSession => ({
  id: toNumber(raw.id),
  session_id: raw.session_id === null || raw.session_id === undefined ? null : toNumber(raw.session_id),
  exam_id: raw.exam_id === null || raw.exam_id === undefined ? null : toNumber(raw.exam_id),
  email: String(raw.email || ''),
  full_name: String(raw.full_name || 'Student'),
  status: normalizeStatus(raw.status),
  is_live: Boolean(raw.is_live),
  violation_count: toNumber(raw.violation_count),
  tier: normalizeTier(raw.tier),
  score: toNumber(raw.score),
  total_marks: toNumber(raw.total_marks),
  progress: toNumber(raw.progress),
  compliance: toNullableNumber(raw.compliance),
  last_active: typeof raw.last_active === 'string' ? raw.last_active : null,
  exam_title: typeof raw.exam_title === 'string' ? raw.exam_title : null,
  duration_minutes: toNumber(raw.duration_minutes),
});

const normalizeStats = (raw: Record<string, unknown> | undefined): AdminLiveStats => {
  if (!raw) return FALLBACK_STATS;
  return {
    active_students: toNumber(raw.active_students),
    red_flags: toNumber(raw.red_flags),
    avg_compliance: toNullableNumber(raw.avg_compliance),
    total_students: toNumber(raw.total_students),
    live_connections: toNumber(raw.live_connections),
    system_status: String(raw.system_status || 'offline'),
  };
};

const normalizePayload = (raw: unknown): AdminLivePayload => {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sessionsRaw = Array.isArray(data.sessions) ? data.sessions : [];
  const sessions = sessionsRaw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => normalizeSession(entry));

  return {
    generated_at: typeof data.generated_at === 'string' ? data.generated_at : null,
    sessions,
    stats: normalizeStats(
      data.stats && typeof data.stats === 'object'
        ? (data.stats as Record<string, unknown>)
        : undefined
    ),
  };
};

const resolveAdminWsUrl = (): string => {
  const explicit = import.meta.env.VITE_ADMIN_WS_URL;
  if (explicit) return explicit;

  const wsBase = import.meta.env.VITE_WS_URL;
  if (wsBase) {
    const trimmed = wsBase.replace(/\/$/, '');
    return `${trimmed}/admin/live`;
  }

  const apiBase = import.meta.env.VITE_API_URL || '';
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    const origin = apiBase
      .replace(/\/api\/v1\/?$/i, '')
      .replace(/\/$/, '');
    return `${origin.replace(/^http/i, 'ws')}/ws/admin/live`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/admin/live`;
};

export function useAdminLiveMonitor() {
  const [payload, setPayload] = useState<AdminLivePayload>(EMPTY_PAYLOAD);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<AdminConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const initializedRef = useRef(false);

  const applyPayload = useCallback((nextPayload: AdminLivePayload) => {
    setPayload(nextPayload);
    setIsLoading(false);
    setError(null);
    initializedRef.current = true;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get('exam/admin/live');
      applyPayload(normalizePayload(response.data));
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setConnectionState('polling');
      }
    } catch {
      if (!initializedRef.current) {
        setIsLoading(false);
      }
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setConnectionState('offline');
      }
      setError('Live monitor is temporarily unavailable. Retrying...');
    }
  }, [applyPayload]);

  useEffect(() => {
    let isMounted = true;
    const token = localStorage.getItem('token');

    if (token) {
      const wsUrl = resolveAdminWsUrl();
      const websocket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (!isMounted) return;
        setConnectionState('live');
        setError(null);
      };

      websocket.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          const type = String(message.type || '');
          if (type === 'admin_live_snapshot') {
            applyPayload(normalizePayload(message));
            setConnectionState('live');
          }
          if (type === 'admin_live_error') {
            setConnectionState('polling');
          }
        } catch {
          // Ignore malformed frames and rely on periodic snapshots.
        }
      };

      websocket.onerror = () => {
        if (!isMounted) return;
        if (websocket.readyState !== WebSocket.OPEN) {
          setConnectionState('polling');
        }
      };

      websocket.onclose = () => {
        if (!isMounted) return;
        setConnectionState('polling');
      };
    } else {
      setConnectionState('offline');
    }

    void refresh();

    const fallbackPollTimer = window.setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        void refresh();
      }
    }, WS_POLL_FALLBACK_MS);

    const resyncTimer = window.setInterval(() => {
      void refresh();
    }, WS_HEALTH_RESYNC_MS);

    const keepAliveTimer = window.setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      try {
        wsRef.current.send(JSON.stringify({ type: 'keepalive' }));
      } catch {
        setConnectionState('polling');
      }
    }, WS_KEEPALIVE_MS);

    return () => {
      isMounted = false;
      window.clearInterval(fallbackPollTimer);
      window.clearInterval(resyncTimer);
      window.clearInterval(keepAliveTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [applyPayload, refresh]);

  return {
    sessions: payload.sessions,
    stats: payload.stats,
    lastUpdated: payload.generated_at,
    isLoading,
    connectionState,
    error,
    refresh,
  };
}
