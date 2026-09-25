import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Phone,
  Users,
  Volume2,
  MonitorX,
  Eye,
  Hand,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileText,
  Activity,
  Shield,
  Clock,
  ArrowLeft,
  Loader2,
  Trash2,
} from 'lucide-react';
import api from '../services/api';
import { formatServerDate, formatServerTime, toTimestampMs } from '../utils/dateTime';

interface ViolationEvent {
  id: number;
  timestamp: number;
  time: string;
  type: 'phone' | 'person-detected' | 'audio-anomaly' | 'tab-switch' | 'face-lost' | 'copy-paste' | 'hand-detected';
  severity: 'safe' | 'warning' | 'critical';
  description: string;
  snapshot?: string;
  snapshotKey?: string;
  aiConfidence: number;
}

interface Session {
  studentName: string;
  rollNumber: string;
  department: string;
  examTitle: string;
  examDate: string;
  duration: number;
  complianceScore: number;
  status: 'flagged' | 'under-review' | 'resolved';
  tabSwitches: number;
}

interface TimelineRecord {
  timestamp: string;
  type: string;
  message: string;
  severity: string;
  ai_confidence?: number;
}

interface EvidenceRecord {
  id: number;
  url: string;
  type: string;
  timestamp: string;
  is_flagged: boolean;
}

interface ClearEvidenceResponse {
  message: string;
  user_id: number;
  deleted_evidence_records: number;
  deleted_logs: number;
  deleted_files: number;
}

const formatSessionStatusLabel = (status: Session['status']): string => {
  if (status === 'resolved') return 'Solved';
  if (status === 'under-review') return 'Under Review';
  return 'Flagged';
};

const normalizeType = (value: string | undefined | null): string =>
  (value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const mapViolationType = (backendType: string): ViolationEvent['type'] | null => {
  const type = normalizeType(backendType);
  if (['phone_detected', 'phone', 'prohibited_object'].includes(type)) return 'phone';
  if (['multiple_people', 'person_detected', 'person'].includes(type)) return 'person-detected';
  if (['audio_anomaly', 'mouth_movement', 'third_party_communication', 'abusive_behavior', 'disruptive_behavior', 'proctor_abuse'].includes(type)) return 'audio-anomaly';
  if (['tab_switch'].includes(type)) return 'tab-switch';
  if (['screen_share_stopped', 'camera_blocked_or_disabled', 'tampering_detected', 'remote_access_detected', 'virtual_machine_detected', 'capture_tool_detected', 'policy_termination'].includes(type)) return 'tab-switch';
  if (['face_not_visible', 'absence', 'looking_away', 'gaze_looking_away', 'face_spoofing', 'head_posture', 'eye_movement', 'identity_mismatch'].includes(type)) return 'face-lost';
  if (['hand_detected', 'hand'].includes(type)) return 'hand-detected';
  if (['copy_paste'].includes(type)) return 'copy-paste';
  return null;
};

const mapSeverity = (backendSeverity: string): ViolationEvent['severity'] => {
  const severity = normalizeType(backendSeverity);
  if (severity === 'high' || severity === 'critical') return 'critical';
  if (severity === 'medium' || severity === 'warning') return 'warning';
  return 'safe';
};

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const buildSession = (student: any, events?: ViolationEvent[]): Session => {
  const violationFallback = Number(student?.violations ?? student?.violation_count ?? 0) || 0;
  const hasLiveEvents = Array.isArray(events);
  const violationCount = hasLiveEvents ? events.length : violationFallback;
  const scoreFromStudent = Number(student?.compliance);
  const complianceScore = Number.isFinite(scoreFromStudent)
    ? clampPercentage(scoreFromStudent)
    : clampPercentage(100 - violationCount * 10);

  return {
    studentName: student?.name || student?.full_name || 'Student',
    rollNumber: student?.rollNo || student?.roll_number || student?.email || 'N/A',
    department: student?.department || 'University Student',
    examTitle: student?.examTitle || student?.exam_title || student?.examName || 'Proctored Session',
    examDate: formatServerDate(student?.last_active),
    duration: Math.max(1, Math.round(Number(student?.examDuration ?? student?.duration_minutes ?? 60) || 60)),
    complianceScore,
    status: student?.status === 'active' ? 'under-review' : (violationCount > 3 || complianceScore < 70 ? 'flagged' : 'resolved'),
    tabSwitches: hasLiveEvents ? events.filter((event) => event.type === 'tab-switch').length : violationFallback,
  };
};

const findClosestEvidence = (
  evidenceList: EvidenceRecord[],
  logTimestampMs: number,
  mappedType: ViolationEvent['type']
): EvidenceRecord | undefined => {
  if (evidenceList.length === 0) return undefined;

  const typed = evidenceList.filter((entry) => mapViolationType(entry.type) === mappedType);
  const source = typed.length > 0 ? typed : evidenceList;

  let nearest: EvidenceRecord | undefined;
  let nearestDelta = Number.POSITIVE_INFINITY;

  for (const evidence of source) {
    const evidenceTime = toTimestampMs(evidence.timestamp);
    if (!evidenceTime) continue;
    const delta = Math.abs(evidenceTime - logTimestampMs);
    if (delta < nearestDelta) {
      nearest = evidence;
      nearestDelta = delta;
    }
  }

  return nearestDelta <= 8000 ? nearest : undefined;
};

export function EvidenceVault({ student, onBack }: { student: any; onBack: () => void }) {
  const [session, setSession] = useState<Session>(() => buildSession(student));
  const [events, setEvents] = useState<ViolationEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ViolationEvent | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<ViolationEvent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isCleaningVault, setIsCleaningVault] = useState(false);
  const [cleanModalState, setCleanModalState] = useState<'closed' | 'confirm' | 'deleting'>('closed');

  const snapshotCacheRef = useRef<Map<string, string>>(new Map());
  const requestIdRef = useRef(0);

  const revokeSnapshotUrls = useCallback(() => {
    snapshotCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    snapshotCacheRef.current.clear();
  }, []);

  const fetchSnapshotBlobUrl = useCallback(async (key: string): Promise<string | undefined> => {
    if (!key) return undefined;

    const cached = snapshotCacheRef.current.get(key);
    if (cached) return cached;

    try {
      const response = await api.get('exam/admin/evidence/file', {
        params: { key },
        responseType: 'blob',
      });

      if (!response?.data || response.data.size === 0) {
        return undefined;
      }

      const blobUrl = URL.createObjectURL(response.data);
      snapshotCacheRef.current.set(key, blobUrl);
      return blobUrl;
    } catch {
      return undefined;
    }
  }, []);

  const fetchEvidenceData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setSession(buildSession(student));
    setSelectedEvent(null);
    setHoveredMarker(null);
    setActionMessage('');
    setLoadError('');
    setEvents([]);

    const activeSessionId = student?.sessionId ?? student?.session_id;

    if (!student?.id || !activeSessionId) {
      setLoadError('No student selected. Please go back and choose a student session.');
      return;
    }

    setIsLoading(true);

    try {
      revokeSnapshotUrls();

      const [timelineRes, evidenceRes] = await Promise.all([
        api.get(`exam/admin/results/session/${activeSessionId}/timeline`),
        api.get(`exam/admin/results/session/${activeSessionId}/evidence`),
      ]);

      if (requestId !== requestIdRef.current) return;

      const timelineData: TimelineRecord[] = Array.isArray(timelineRes.data) ? timelineRes.data : [];
      const evidenceList: EvidenceRecord[] = Array.isArray(evidenceRes.data) ? evidenceRes.data : [];

      const sortedTimeline = [...timelineData]
        .filter((entry) => toTimestampMs(entry.timestamp) > 0)
        .sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp));

      const sortedEvidence = [...evidenceList]
        .filter((entry) => Boolean(entry?.url))
        .sort((a, b) => toTimestampMs(a.timestamp) - toTimestampMs(b.timestamp));

      const timelineSource: TimelineRecord[] = sortedTimeline.length > 0
        ? sortedTimeline
        : sortedEvidence.map((entry) => ({
          timestamp: entry.timestamp,
          type: entry.type,
          message: entry.type || 'Suspicious activity detected',
          severity: entry.is_flagged ? 'high' : 'medium',
          ai_confidence: entry.is_flagged ? 95 : 75,
        }));

      if (timelineSource.length === 0) {
        setEvents([]);
        setSelectedEvent(null);
        setSession(buildClearedSession());
        return;
      }

      const startTimeMs = toTimestampMs(timelineSource[0].timestamp) || Date.now();

      const mappedWithoutSnapshots = timelineSource
        .map((log, index) => {
          const mappedType = mapViolationType(log.type);
          if (!mappedType) return null;

          const logTimestampMs = toTimestampMs(log.timestamp);
          if (!logTimestampMs) return null;

          const matchingEvidence = findClosestEvidence(sortedEvidence, logTimestampMs, mappedType);
          const aiConfidence = Number.isFinite(Number(log.ai_confidence))
            ? clampPercentage(Number(log.ai_confidence))
            : 90;

          return {
            id: index + 1,
            timestamp: Math.max(0, Math.round((logTimestampMs - startTimeMs) / 1000)),
            time: formatServerTime(logTimestampMs),
            type: mappedType,
            severity: mapSeverity(log.severity),
            description: log.message || log.type || 'Suspicious activity detected',
            snapshotKey: matchingEvidence?.url,
            aiConfidence,
          } as ViolationEvent;
        })
        .filter((event): event is ViolationEvent => Boolean(event));

      const mappedEvents = await Promise.all(
        mappedWithoutSnapshots.map(async (event) => {
          if (!event.snapshotKey) return event;
          const snapshot = await fetchSnapshotBlobUrl(event.snapshotKey);
          return {
            ...event,
            snapshot,
          };
        })
      );

      if (requestId !== requestIdRef.current) return;

      setEvents(mappedEvents);
      setSelectedEvent(mappedEvents[0] || null);
      setSession(buildSession(student, mappedEvents));
    } catch {
      if (requestId === requestIdRef.current) {
        setLoadError('Failed to load evidence data. Please refresh and try again.');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [student, fetchSnapshotBlobUrl, revokeSnapshotUrls]);

  useEffect(() => {
    void fetchEvidenceData();
  }, [fetchEvidenceData]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    revokeSnapshotUrls();
  }, [revokeSnapshotUrls]);

  const getEventIcon = (type: ViolationEvent['type']) => {
    switch (type) {
      case 'phone': return Phone;
      case 'person-detected': return Users;
      case 'hand-detected': return Hand;
      case 'audio-anomaly': return Volume2;
      case 'tab-switch': return MonitorX;
      case 'face-lost': return Eye;
      case 'copy-paste': return FileText;
      default: return AlertTriangle;
    }
  };

  const formatTime = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDurationSeconds = Math.max(60, session.duration * 60);
  const timelineTicks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((ratio) => formatTime(totalDurationSeconds * ratio)),
    [totalDurationSeconds]
  );

  const criticalCount = useMemo(
    () => events.filter((event) => event.severity === 'critical').length,
    [events]
  );

  const audioSpikeCount = useMemo(
    () => events.filter((event) => event.type === 'audio-anomaly').length,
    [events]
  );

  const hasVaultData = events.length > 0;
  const canMarkClean = Boolean(student?.sessionId ?? student?.session_id) && !isCleaningVault;
  const buildClearedSession = useCallback((): Session => ({
    ...buildSession(student, []),
    status: 'resolved',
    tabSwitches: 0,
  }), [student]);

  const handleVerdictAction = (action: 'malpractice' | 'clean' | 'interview') => {
    if (!selectedEvent) {
      setActionMessage('Select an event before applying a verdict.');
      return;
    }

    if (action === 'malpractice') {
      setSession((current) => ({ ...current, status: 'flagged' }));
      setActionMessage(`Malpractice confirmed for ${selectedEvent.time}.`);
      return;
    }

    setSession((current) => ({ ...current, status: 'under-review' }));
    setActionMessage(`Manual review requested for ${selectedEvent.time}.`);
  };

  const closeCleanModal = useCallback(() => {
    if (isCleaningVault) {
      return;
    }
    setCleanModalState('closed');
  }, [isCleaningVault]);

  const openCleanModal = useCallback(() => {
    if (!canMarkClean) {
      return;
    }
    setActionMessage('');
    setLoadError('');
    setCleanModalState('confirm');
  }, [canMarkClean]);

  const handleCleanOverlayClick = useCallback(() => {
    if (isCleaningVault) {
      return;
    }
    setCleanModalState('closed');
  }, []);

  const handleConfirmCleanVault = useCallback(async () => {
    const activeSessionId = student?.sessionId ?? student?.session_id;
    if (!activeSessionId) {
      return;
    }

    setIsCleaningVault(true);
    setLoadError('');
    setCleanModalState('deleting');

    try {
      const response = await api.delete<ClearEvidenceResponse>(`exam/admin/results/session/${activeSessionId}/evidence`);
      await fetchEvidenceData();
      setSession(buildClearedSession());

      const result = response.data;
      setActionMessage(
        `Session marked as clean and solved. ${result.message}. Removed ${result.deleted_evidence_records} evidence item${result.deleted_evidence_records === 1 ? '' : 's'}, ${result.deleted_logs} timeline record${result.deleted_logs === 1 ? '' : 's'}, and ${result.deleted_files} file${result.deleted_files === 1 ? '' : 's'}.`
      );
      setCleanModalState('closed');
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setLoadError(typeof detail === 'string' && detail.trim() ? detail : 'Failed to clear evidence vault data. Please try again.');
      setCleanModalState('confirm');
    } finally {
      setIsCleaningVault(false);
    }
  }, [buildClearedSession, fetchEvidenceData, student?.sessionId, student?.session_id]);

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <motion.button
        onClick={onBack}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="mb-4 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Results Dashboard
      </motion.button>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-2xl font-bold text-white shadow-md">
              {(session.studentName || 'S').charAt(0).toUpperCase()}
            </div>

            <div>
              <h1 className="text-2xl font-bold text-slate-900">{session.studentName}</h1>
              <div className="mt-1 flex items-center gap-3 text-sm">
                <span className="font-semibold text-slate-700">{session.rollNumber}</span>
                <span className="text-slate-400">|</span>
                <span className="text-slate-600">{session.department}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {session.examTitle} - {session.examDate} - {session.duration} min
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Compliance Score</p>
            <div className={`inline-flex items-center justify-center rounded-xl border-2 px-6 py-3 ${session.complianceScore < 50
              ? 'border-red-500 bg-red-50'
              : session.complianceScore < 75
                ? 'border-amber-500 bg-amber-50'
                : 'border-green-500 bg-green-50'
              }`}>
              <span className={`text-4xl font-bold ${session.complianceScore < 50 ? 'text-red-600' : session.complianceScore < 75 ? 'text-amber-600' : 'text-green-600'
                }`}>
                {session.complianceScore}%
              </span>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <div className={`h-2 w-2 rounded-full ${session.status === 'flagged' ? 'bg-red-500' : session.status === 'under-review' ? 'bg-amber-500' : 'bg-green-500'}`} />
              <span className={`text-xs font-semibold uppercase ${session.status === 'flagged' ? 'text-red-600' : session.status === 'under-review' ? 'text-amber-600' : 'text-green-600'
                }`}>
                {formatSessionStatusLabel(session.status)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-900">Session Timeline</h2>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="text-slate-600">Safe</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-slate-600">Flagged</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-600" />
          </div>
        ) : (
          <div className="relative mb-4">
            <div className="relative h-12 w-full overflow-hidden rounded-lg border border-slate-300 bg-gradient-to-r from-green-50 to-green-100">
              {events.map((event) => {
                const position = (event.timestamp / totalDurationSeconds) * 100;
                const boundedPosition = Math.max(0, Math.min(100, position));
                const isCritical = event.severity === 'critical';
                return (
                  <div
                    key={`zone-${event.id}`}
                    className={`absolute top-0 bottom-0 ${isCritical ? 'bg-red-100' : 'bg-amber-100'}`}
                    style={{
                      left: `${Math.max(0, boundedPosition - 1.5)}%`,
                      width: '3%',
                    }}
                  />
                );
              })}

              {events.map((event) => {
                const position = (event.timestamp / totalDurationSeconds) * 100;
                const boundedPosition = Math.max(0, Math.min(100, position));
                const EventIcon = getEventIcon(event.type);
                const isHovered = hoveredMarker?.id === event.id;
                const isCritical = event.severity === 'critical';

                return (
                  <div
                    key={`marker-${event.id}`}
                    className="absolute top-0 bottom-0 flex items-center"
                    style={{ left: `${boundedPosition}%` }}
                    onMouseEnter={() => setHoveredMarker(event)}
                    onMouseLeave={() => setHoveredMarker(null)}
                    onClick={() => setSelectedEvent(event)}
                  >
                    <div className={`h-full w-0.5 ${isCritical ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <motion.div
                      className={`absolute top-1/2 -ml-2.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full ${isCritical ? 'bg-red-500' : 'bg-amber-500'
                        } shadow-md ring-2 ring-white`}
                      whileHover={{ scale: 1.3 }}
                    >
                      <EventIcon className="h-3 w-3 text-white" />
                    </motion.div>

                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute -top-20 left-1/2 z-50 w-56 -translate-x-1/2 rounded-lg border border-slate-300 bg-white p-3 shadow-xl"
                      >
                        <div className="flex items-start gap-2">
                          <EventIcon className={`h-4 w-4 ${isCritical ? 'text-red-500' : 'text-amber-500'}`} />
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{event.description}</p>
                            <p className="mt-1 text-xs text-slate-500">{event.time} - AI: {event.aiConfidence}%</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex justify-between text-xs text-slate-500">
              {timelineTicks.map((tick, index) => (
                <span key={`${tick}-${index}`}>{tick}</span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <MonitorX className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-slate-600">Tab Switches</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{session.tabSwitches}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-xs text-slate-600">Critical Alerts</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{criticalCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-slate-600">Audio Spikes</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{audioSpikeCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-600" />
              <span className="text-xs text-slate-600">Total Events</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-900">{events.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Shield className="h-5 w-5 text-cyan-600" />
                Evidence Gallery
              </h3>
              <span className="text-sm text-slate-500">{events.length} snapshots</span>
            </div>

            {isLoading ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-600" />
              </div>
            ) : events.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
                No evidence events available for this session.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {events.map((event) => {
                  const EventIcon = getEventIcon(event.type);
                  const isCritical = event.severity === 'critical';
                  const isSelected = selectedEvent?.id === event.id;

                  return (
                    <motion.button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`group relative overflow-hidden rounded-lg border-2 transition-all ${isSelected
                        ? 'border-cyan-500 shadow-md shadow-cyan-100'
                        : isCritical
                          ? 'border-red-300 hover:border-red-500'
                          : 'border-amber-300 hover:border-amber-500'
                        }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="relative aspect-video bg-gray-100 border-b">
                        {['tab-switch', 'copy-paste', 'audio-anomaly'].includes(event.type) ? (
                          <div className="flex h-full flex-col items-center justify-center bg-slate-50">
                            <EventIcon className={`mb-2 h-12 w-12 ${isCritical ? 'text-red-400' : 'text-amber-400'}`} />
                            <span className="text-sm font-medium text-slate-600">
                              {event.type === 'tab-switch' ? 'Browser Tab Switched' :
                                event.type === 'copy-paste' ? 'Clipboard Activity' :
                                  'Audio Threshold Exceeded'}
                            </span>
                          </div>
                        ) : event.snapshot ? (
                          <img
                            src={event.snapshot}
                            alt="Evidence"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center bg-slate-100">
                            <EventIcon className="h-10 w-10 text-slate-300" />
                            <span className="mt-2 text-xs text-slate-400">No Camera Snapshot</span>
                          </div>
                        )}

                        {isCritical && (
                          <div className="absolute inset-6 border-2 border-red-500">
                            <div className="absolute -right-0.5 -top-0.5 h-2 w-2 bg-red-500" />
                            <div className="absolute -left-0.5 -top-0.5 h-2 w-2 bg-red-500" />
                            <div className="absolute -right-0.5 -bottom-0.5 h-2 w-2 bg-red-500" />
                            <div className="absolute -bottom-0.5 -left-0.5 h-2 w-2 bg-red-500" />
                          </div>
                        )}

                        <div className="absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-0.5 text-xs text-white">
                          {event.time}
                        </div>

                        <div className={`absolute right-2 top-2 rounded px-2 py-0.5 text-xs font-semibold ${isCritical ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                          }`}>
                          {event.aiConfidence}%
                        </div>
                      </div>

                      <div className={`border-t-2 p-2 ${isSelected
                        ? 'border-cyan-500 bg-cyan-50'
                        : isCritical
                          ? 'border-red-300 bg-white'
                          : 'border-amber-300 bg-white'
                        }`}>
                        <div className="flex items-center gap-2">
                          <EventIcon className={`h-3.5 w-3.5 ${isCritical ? 'text-red-500' : 'text-amber-500'}`} />
                          <p className="text-xs font-semibold text-slate-900">{event.description}</p>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
              <Shield className="h-5 w-5 text-cyan-600" />
              Verdict Console
            </h3>

            <div className="space-y-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleVerdictAction('malpractice')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-red-500 bg-red-500 px-4 py-3 font-semibold uppercase tracking-wide text-white shadow-md transition-all hover:bg-red-600"
              >
                <XCircle className="h-5 w-5" />
                Confirm Malpractice
              </motion.button>

              <motion.button
                whileHover={{ scale: canMarkClean ? 1.02 : 1 }}
                whileTap={{ scale: canMarkClean ? 0.98 : 1 }}
                onClick={openCleanModal}
                disabled={!canMarkClean}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 font-semibold uppercase tracking-wide transition-all ${
                  canMarkClean
                    ? 'border-green-500 bg-white text-green-600 hover:bg-green-50'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                }`}
              >
                {isCleaningVault ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                {isCleaningVault ? 'Cleaning...' : 'Mark as Clean'}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleVerdictAction('interview')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-amber-500 bg-white px-4 py-3 font-semibold uppercase tracking-wide text-amber-600 transition-all hover:bg-amber-50"
              >
                <FileText className="h-5 w-5" />
                Request Interview
              </motion.button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-purple-600" />
                <span className="text-xs font-semibold text-slate-700">Audio Analysis</span>
              </div>
              <div className="flex h-10 items-end justify-around gap-0.5">
                {[...Array(24)].map((_, i) => {
                  const isSpike = [5, 9, 16, 19].includes(i);
                  const height = isSpike ? Math.random() * 70 + 30 : Math.random() * 25 + 10;
                  return (
                    <div
                      key={i}
                      className={`w-1 rounded-sm ${isSpike ? 'bg-purple-500' : 'bg-slate-300'}`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
            </div>

            {selectedEvent && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Selected Event</p>
                <p className="mt-1">{selectedEvent.description}</p>
                <p className="mt-1 text-slate-500">{selectedEvent.time} - {selectedEvent.aiConfidence}% confidence</p>
              </div>
            )}

            {actionMessage && (
              <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-700">
                {actionMessage}
              </div>
            )}

            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Mark as Clean will clear this student&apos;s Evidence Vault data and set the review status to solved.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
              <Clock className="h-5 w-5 text-cyan-600" />
              Event Log
            </h3>

            <div className="space-y-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
                </div>
              ) : events.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No system logs available</p>
              ) : (
                events.map((log, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-2.5 ${log.severity === 'critical'
                      ? 'border-red-200 bg-red-50'
                      : 'border-amber-200 bg-amber-50'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600">{log.time}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${log.severity === 'critical' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
                        {log.type.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{log.description}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {cleanModalState !== 'closed' && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"
          onClick={handleCleanOverlayClick}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mx-auto my-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {cleanModalState === 'confirm' ? (
              <>
                <div className="p-6">
                  <div className="mb-5 flex flex-col items-center text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                      <Trash2 className="h-6 w-6" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Mark this session as clean?</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      Delete <span className="font-semibold text-slate-800">{session.studentName}</span>&apos;s vault evidence and move this review to solved?
                    </p>
                  </div>

                  <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
                    This permanently removes snapshots, suspicious timeline entries, tab-switch records, and related vault evidence for this student.
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium text-slate-500">Student</span>
                      <span className="font-semibold text-slate-900">{session.studentName}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium text-slate-500">Current vault items</span>
                      <span className="font-semibold text-slate-900">{events.length}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium text-slate-500">Current tab switches</span>
                      <span className="font-semibold text-slate-900">{session.tabSwitches}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white px-6 py-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={closeCleanModal}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmCleanVault()}
                    className="rounded-lg bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
                  >
                    OK, Mark as Clean
                  </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
                  <Loader2 className="h-8 w-8 animate-spin text-rose-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Marking clean and deleting evidence</h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
                  Please wait while we update the review status to solved and permanently remove this student&apos;s vault evidence, snapshots, and related records.
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
