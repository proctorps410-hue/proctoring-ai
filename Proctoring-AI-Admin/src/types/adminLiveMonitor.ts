export type AdminSessionStatus = 'active' | 'offline' | 'completed' | 'terminated';

export type AdminRiskTier = 'Safe' | 'Watch' | 'Flagged' | 'Critical';

export type AdminConnectionState = 'connecting' | 'live' | 'polling' | 'offline';

export interface AdminLiveSession {
  id: number;
  session_id: number | null;
  exam_id: number | null;
  email: string;
  full_name: string;
  status: AdminSessionStatus;
  is_live: boolean;
  violation_count: number;
  tier: AdminRiskTier;
  score: number;
  total_marks: number;
  progress: number;
  compliance: number | null;
  last_active: string | null;
  exam_title: string | null;
  duration_minutes: number;
}

export interface AdminLiveStats {
  active_students: number;
  red_flags: number;
  avg_compliance: number | null;
  total_students: number;
  live_connections: number;
  system_status: string;
}

export interface AdminLivePayload {
  generated_at: string | null;
  sessions: AdminLiveSession[];
  stats: AdminLiveStats;
}
