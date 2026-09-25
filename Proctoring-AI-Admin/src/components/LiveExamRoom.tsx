import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, Eye, Search, Filter,
  AlertCircle, Clock, Users, Shield, X,
} from 'lucide-react';
import { Activity, TrendingUp } from 'lucide-react';
import type { ExamRoom } from '../hooks/useExamRooms';
import type { AdminRiskTier, AdminSessionStatus } from '../types/adminLiveMonitor';

interface LiveExamRoomProps {
  room: ExamRoom;
  onBack: () => void;
  onReview?: (student: any) => void;
  connectionState: string;
  lastUpdated: string | null;
}

const formatRelative = (v: string | null) => {
  if (!v) return 'No activity';
  const d = Math.max(0, Math.round((Date.now() - Date.parse(v)) / 1000));
  if (d < 5) return 'Just now';
  if (d < 60) return `${d}s ago`;
  const m = Math.round(d / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

const tierColor = (tier: AdminRiskTier) => {
  if (tier === 'Critical') return { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.35)', text: '#f87171' };
  if (tier === 'Flagged') return { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)', text: '#fb923c' };
  if (tier === 'Watch') return { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', text: '#fbbf24' };
  return { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.25)', text: '#4ade80' };
};

const statusConfig = (status: AdminSessionStatus) => {
  if (status === 'active') return { col: '#22c55e', label: 'Active', pulse: true };
  if (status === 'completed') return { col: '#60a5fa', label: 'Completed', pulse: false };
  if (status === 'terminated') return { col: '#f87171', label: 'Terminated', pulse: false };
  return { col: '#64748b', label: 'Offline', pulse: false };
};

type SortKey = 'tier' | 'violations' | 'name' | 'progress';
type StatusFilter = 'all' | AdminSessionStatus;
type TierFilter = 'all' | AdminRiskTier;

const tierRank: Record<AdminRiskTier, number> = { Critical: 0, Flagged: 1, Watch: 2, Safe: 3 };
const statusRank: Record<AdminSessionStatus, number> = { active: 0, offline: 1, completed: 2, terminated: 3 };

export function LiveExamRoom({ room, onBack, onReview, lastUpdated }: LiveExamRoomProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('tier');
  const [showFilters, setShowFilters] = useState(false);

  // Countdown timer
  const [, forceRerender] = useState(0);
  useMemo(() => {
    const t = setInterval(() => forceRerender(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const timeLeft = useMemo(() => {
    if (!room.end_time) return null;
    const diff = Math.max(0, Math.floor((new Date(room.end_time).getTime() - Date.now()) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (h > 0) return `${h}h ${m}m left`;
    if (m > 0) return `${m}m ${s}s left`;
    return diff > 0 ? `${s}s left` : 'Ended';
  }, [room.end_time]);

  const filtered = useMemo(() => {
    let list = [...room.sessions];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    if (tierFilter !== 'all') list = list.filter(s => s.tier === tierFilter);
    list.sort((a, b) => {
      if (sortKey === 'tier') return tierRank[a.tier] - tierRank[b.tier] || statusRank[a.status] - statusRank[b.status];
      if (sortKey === 'violations') return b.violation_count - a.violation_count;
      if (sortKey === 'progress') return b.progress - a.progress;
      return a.full_name.localeCompare(b.full_name);
    });
    return list;
  }, [room.sessions, search, statusFilter, tierFilter, sortKey]);

  const headerStyle = {
    background: 'linear-gradient(135deg, #060c1a 0%, #0c1630 100%)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  };

  return (
    <div className="min-h-screen pb-8" style={{ background: 'linear-gradient(135deg,#060c1a 0%,#0c1630 60%,#060c1a 100%)' }}>
      <style>{`
        .lr-glass { background: rgba(255,255,255,0.035); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,0.07); }
        .lr-card { background: linear-gradient(135deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.018) 100%); border:1px solid rgba(255,255,255,0.07); }
        .lr-row:hover { background: rgba(255,255,255,0.03); }
        .lr-row { transition: background .15s; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .pulse-dot { animation: pd 1.5s ease-in-out infinite; }
        @keyframes pd { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        .prog-bar { height:5px; border-radius:99px; background:rgba(255,255,255,0.07); overflow:hidden; }
        .prog-fill { height:100%; border-radius:99px; }
      `}</style>

      {/* ── Header ── */}
      <div className="sticky top-0 z-20 px-6 py-4" style={headerStyle}>
        <div className="flex items-center justify-between gap-4 max-w-[1400px] mx-auto">
          {/* Back + title */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button onClick={onBack}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors group flex-shrink-0"
            >
              <div className="h-9 w-9 rounded-xl lr-glass flex items-center justify-center group-hover:border-violet-500/40 transition-all">
                <ChevronLeft className="h-4 w-4" />
              </div>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 flex-shrink-0">Room</span>
                <h1 className="text-lg font-black text-white truncate">{room.title}</h1>
                {room.status === 'active' && (
                  <span className="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold"
                    style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />LIVE
                  </span>
                )}
                {room.critical_count > 0 && (
                  <span className="flex-shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold"
                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                    🔴 {room.critical_count} Critical
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">{room.duration_minutes} min exam · {room.question_count} questions</p>
            </div>
          </div>

          {/* Right stats */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {timeLeft && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 lr-glass text-sm font-bold"
                style={{ color: timeLeft === 'Ended' ? '#f87171' : timeLeft.includes('m') && parseInt(timeLeft) < 10 ? '#fbbf24' : '#94a3b8' }}>
                <Clock className="h-4 w-4" />{timeLeft}
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 lr-glass">
              <Users className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-bold text-white">{room.active_count}</span>
              <span className="text-xs text-slate-600">active</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-5 space-y-4">
        {/* ── Quick stat tiles ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Active Students', value: room.active_count, icon: Activity, col: '#818cf8' },
            { label: 'Flagged / At Risk', value: room.flagged_count, icon: AlertCircle, col: room.flagged_count > 0 ? '#fb923c' : '#4ade80' },
            { label: 'Avg Compliance', value: room.avg_compliance !== null ? `${room.avg_compliance}%` : 'N/A', icon: Shield, col: room.avg_compliance !== null && room.avg_compliance < 70 ? '#ef4444' : '#22c55e' },
            { label: 'Total Attempts', value: room.attempt_count, icon: TrendingUp, col: '#60a5fa' },
          ].map(({ label, value, icon: Icon, col }) => (
            <div key={label} className="lr-card rounded-2xl p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${col}18`, border: `1px solid ${col}30` }}>
                <Icon className="h-5 w-5" style={{ color: col }} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                <p className="text-xl font-black text-white">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Table panel ── */}
        <div className="lr-card rounded-3xl overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search students..."
                  className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-700 focus:outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }} />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Sort chips */}
              <div className="flex gap-2">
                {(['tier', 'violations', 'progress', 'name'] as SortKey[]).map(sk => (
                  <button key={sk} onClick={() => setSortKey(sk)}
                    className="px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all duration-150"
                    style={{
                      background: sortKey === sk ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                      border: sortKey === sk ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.06)',
                      color: sortKey === sk ? '#a5b4fc' : '#64748b',
                    }}>{sk}</button>
                ))}
              </div>

              {/* Filter toggle */}
              <button onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: showFilters ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                  border: showFilters ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.07)',
                  color: showFilters ? '#a5b4fc' : '#64748b',
                }}>
                <Filter className="h-3.5 w-3.5" /> Filters
              </button>

              <span className="ml-auto text-xs text-slate-600">{filtered.length} of {room.sessions.length}</span>
            </div>

            {/* Filter expand */}
            <AnimatePresence>
              {showFilters && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-4 pt-4 mt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Status</p>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'active', 'completed', 'terminated', 'offline'] as const).map(s => (
                          <button key={s} onClick={() => setStatusFilter(s)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all capitalize"
                            style={{
                              background: statusFilter === s ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                              border: statusFilter === s ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                              color: statusFilter === s ? '#a5b4fc' : '#64748b',
                            }}>{s}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Risk Tier</p>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'Critical', 'Flagged', 'Watch', 'Safe'] as const).map(t => (
                          <button key={t} onClick={() => setTierFilter(t)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                            style={{
                              background: tierFilter === t ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                              border: tierFilter === t ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                              color: tierFilter === t ? '#a5b4fc' : '#64748b',
                            }}>{t}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  {['Student', 'Status', 'Last Active', 'Progress', 'Violations', 'Risk Tier', 'Compliance', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? filtered.map((s, i) => {
                  const tc = tierColor(s.tier);
                  const sc = statusConfig(s.status);
                  const pct = Math.min(100, Math.max(0, Math.round(s.progress)));
                  const compColor = s.compliance !== null && s.compliance < 60 ? '#ef4444' : s.compliance !== null && s.compliance < 80 ? '#f59e0b' : '#22c55e';
                  return (
                    <motion.tr key={s.id} className="lr-row"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                      {/* Student */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <div className="h-9 w-9 rounded-xl flex items-center justify-center text-sm font-black text-white"
                              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                              {(s.full_name?.[0] || 'S').toUpperCase()}
                            </div>
                            {s.status === 'active' && (
                              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 flex items-center justify-center"
                                style={{ background: '#060c1a', borderColor: '#060c1a' }}>
                                <div className="h-2 w-2 rounded-full pulse-dot" style={{ background: '#22c55e' }} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{s.full_name}</p>
                            <p className="text-xs text-slate-600 truncate">{s.email}</p>
                          </div>
                        </div>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          {sc.pulse ? (
                            <span className="relative flex h-2 w-2 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: sc.col }} />
                              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: sc.col }} />
                            </span>
                          ) : (
                            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: sc.col }} />
                          )}
                          <span className="text-sm font-semibold" style={{ color: sc.col }}>{sc.label}</span>
                        </div>
                      </td>
                      {/* Last Active */}
                      <td className="px-4 py-4 text-xs text-slate-500">{formatRelative(s.last_active)}</td>
                      {/* Progress */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2.5 min-w-[100px]">
                          <div className="prog-bar flex-1">
                            <div className="prog-fill" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
                          </div>
                          <span className="text-xs font-bold text-slate-400 flex-shrink-0">{pct}%</span>
                        </div>
                      </td>
                      {/* Violations */}
                      <td className="px-4 py-4 text-center">
                        {s.violation_count > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-sm font-black text-rose-400"
                            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>
                            {s.violation_count}
                          </span>
                        ) : (
                          <span className="text-slate-700 text-sm">—</span>
                        )}
                      </td>
                      {/* Tier */}
                      <td className="px-4 py-4">
                        <span className="rounded-lg px-2.5 py-1 text-xs font-bold"
                          style={{ background: tc.bg, border: `1px solid ${tc.border}`, color: tc.text }}>
                          {s.tier}
                        </span>
                      </td>
                      {/* Compliance */}
                      <td className="px-4 py-4 text-sm font-bold" style={{ color: compColor }}>
                        {s.compliance !== null ? `${s.compliance}%` : '—'}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-4">
                        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                          onClick={() => onReview?.({ ...s, name: s.full_name, violations: s.violation_count, examName: room.title })}
                          className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition-all"
                          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 15px rgba(99,102,241,0.4)' }}>
                          <Eye className="h-3.5 w-3.5" /> Evidence
                        </motion.button>
                      </td>
                    </motion.tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Users className="h-10 w-10 text-slate-700" />
                        <p className="text-sm text-slate-600">No students found matching your filters</p>
                        {(search || statusFilter !== 'all' || tierFilter !== 'all') && (
                          <button onClick={() => { setSearch(''); setStatusFilter('all'); setTierFilter('all'); }}
                            className="text-xs font-bold text-violet-400 hover:text-violet-300">Clear filters</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 flex items-center justify-between text-xs text-slate-600"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span>Showing {filtered.length} of {room.sessions.length} participants</span>
            {lastUpdated && <span>{formatRelative(lastUpdated)} · auto-refreshing</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
