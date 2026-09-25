import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle, BookOpen, Clock, DoorOpen,
  RefreshCw, Shield, Users, Zap, Lock, Copy, Check,
} from 'lucide-react';
import { useExamRooms, type ExamRoom } from '../hooks/useExamRooms';
import { RoomKeyModal, isRoomUnlocked } from './RoomKeyModal';
import { LiveExamRoom } from './LiveExamRoom';
import { useAdminLiveMonitor } from '../hooks/useAdminLiveMonitor';

interface LiveMonitorLobbyProps {
  onReview?: (student: any) => void;
}

const GRADIENTS = [
  'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.08))',
  'linear-gradient(135deg, rgba(236,72,153,0.15), rgba(244,114,182,0.07))',
  'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(52,211,153,0.07))',
  'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.07))',
  'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(96,165,250,0.07))',
  'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(248,113,113,0.07))',
];

function formatTimeLeft(endTime: string | null): { text: string; urgent: boolean } {
  if (!endTime) return { text: 'No end time', urgent: false };
  const diff = Math.max(0, Math.floor((new Date(endTime).getTime() - Date.now()) / 1000));
  if (diff === 0) return { text: 'Ended', urgent: true };
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return { text: `${h}h ${m}m left`, urgent: false };
  if (m > 5) return { text: `${m}m left`, urgent: false };
  return { text: `${m}m ${diff % 60}s left`, urgent: true };
}

function CopyableKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all duration-150 group"
      style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
      <span className="text-xs font-black tracking-widest" style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{value}</span>
      {copied
        ? <Check className="h-3 w-3 text-emerald-400" />
        : <Copy className="h-3 w-3 text-slate-500 group-hover:text-violet-400 transition-colors" />}
    </button>
  );
}

function ExamRoomCard({
  room, index, onEnter,
}: { room: ExamRoom; index: number; onEnter: (room: ExamRoom) => void }) {
  const grad = GRADIENTS[index % GRADIENTS.length];
  const unlocked = isRoomUnlocked(room.exam_id);
  const { text: timeLeft, urgent } = formatTimeLeft(room.end_time);
  const isLive = room.status === 'active';

  const statusBadge = () => {
    if (room.status === 'active') return { label: '● LIVE', col: '#4ade80', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)' };
    if (room.status === 'upcoming') return { label: '◷ UPCOMING', col: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)' };
    if (room.status === 'ended') return { label: '■ ENDED', col: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)' };
    return { label: '○ INACTIVE', col: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' };
  };
  const badge = statusBadge();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', damping: 20, stiffness: 220 }}
      whileHover={{ y: -5, transition: { duration: 0.2 } }}
      className="relative rounded-3xl overflow-hidden cursor-pointer group"
      style={{ background: grad, border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Alert glow if critical */}
      {room.critical_count > 0 && (
        <div className="absolute inset-0 rounded-3xl pointer-events-none"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.4), 0 0 30px rgba(239,68,68,0.15)' }} />
      )}

      {/* Room number tag */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Room #{String(index + 1).padStart(2, '0')}</span>
        {unlocked && (
          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
            <Check className="h-3 w-3" /> Unlocked
          </span>
        )}
      </div>

      <div className="p-6 pt-10 space-y-4">
        {/* Status + time */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <span className="rounded-lg px-2.5 py-1 text-xs font-black uppercase tracking-wider flex-shrink-0"
            style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.col }}>
            {badge.label}
          </span>
          {isLive && (
            <span className="text-xs font-bold flex-shrink-0 flex items-center gap-1.5"
              style={{ color: urgent ? '#f87171' : '#94a3b8' }}>
              <Clock className="h-3 w-3" />{timeLeft}
            </span>
          )}
        </div>

        {/* Title */}
        <div>
          <h3 className="text-lg font-black text-white leading-snug mb-1">{room.title}</h3>
          {room.description && (
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{room.description}</p>
          )}
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Active</p>
            <p className="text-lg font-black text-white">{room.active_count}</p>
          </div>
          <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Flagged</p>
            <p className="text-lg font-black" style={{ color: room.flagged_count > 0 ? '#fb923c' : '#4ade80' }}>{room.flagged_count}</p>
          </div>
          <div className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Integrity</p>
            <p className="text-lg font-black" style={{ color: room.avg_compliance !== null && room.avg_compliance < 70 ? '#ef4444' : '#22c55e' }}>
              {room.avg_compliance !== null ? `${room.avg_compliance}%` : '—'}
            </p>
          </div>
        </div>

        {/* Critical alert bar */}
        {room.critical_count > 0 && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
            <p className="text-xs font-bold text-rose-300">{room.critical_count} student{room.critical_count > 1 ? 's' : ''} at critical risk level</p>
          </div>
        )}

        {/* Monitor key */}
        {room.monitor_key && (
          <div className="flex items-center justify-between gap-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-1">
              <Lock className="h-3 w-3" /> Monitor Key
            </span>
            <CopyableKey value={room.monitor_key} />
          </div>
        )}
        {!room.monitor_key && (
          <div className="flex items-center gap-1.5 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <Lock className="h-3 w-3 text-slate-700" />
            <span className="text-[10px] text-slate-700">No monitor key — created before key system</span>
          </div>
        )}

        {/* Enter / info footer */}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex items-center gap-3 text-[10px] text-slate-600 flex-1">
            <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{room.question_count}Q</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{room.duration_minutes}m</span>
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{room.attempt_count} total</span>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={(e) => { e.stopPropagation(); onEnter(room); }}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white flex-shrink-0 transition-all"
            style={{
              background: unlocked
                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: unlocked ? '0 4px 20px rgba(34,197,94,0.4)' : '0 4px 20px rgba(99,102,241,0.5)',
            }}>
            {unlocked ? <DoorOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {unlocked ? 'Enter' : 'Unlock'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

export function LiveMonitorLobby({ onReview }: LiveMonitorLobbyProps) {
  const { rooms, isLoading, error, lastUpdated, refresh } = useExamRooms();
  const liveMonitor = useAdminLiveMonitor();

  const [selectedRoom, setSelectedRoom] = useState<ExamRoom | null>(null);
  const [keyModalRoom, setKeyModalRoom] = useState<ExamRoom | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'ended'>('all');

  const filteredRooms = useMemo(() => {
    if (statusFilter === 'all') return rooms;
    return rooms.filter(r => r.status === statusFilter);
  }, [rooms, statusFilter]);

  // If inside a room, show it
  if (selectedRoom) {
    return (
      <LiveExamRoom
        room={selectedRoom}
        onBack={() => setSelectedRoom(null)}
        onReview={onReview}
        connectionState={liveMonitor.connectionState}
        lastUpdated={lastUpdated}
      />
    );
  }

  const handleEnterRoom = (room: ExamRoom) => {
    if (!room.monitor_key || isRoomUnlocked(room.exam_id)) {
      setSelectedRoom(room);
    } else {
      setKeyModalRoom(room);
    }
  };

  const totalActive = rooms.reduce((a, r) => a + r.active_count, 0);
  const totalCritical = rooms.reduce((a, r) => a + r.critical_count, 0);
  const liveRooms = rooms.filter(r => r.status === 'active').length;

  return (
    <div className="min-h-screen pb-12" style={{ background: 'linear-gradient(135deg,#060c1a 0%,#0c1630 60%,#060c1a 100%)' }}>
      <style>{`
        .lml-glass { background:rgba(255,255,255,0.035); backdrop-filter:blur(20px); border:1px solid rgba(255,255,255,0.07); }
        .lml-card { background:linear-gradient(135deg,rgba(255,255,255,0.055) 0%,rgba(255,255,255,0.018) 100%); border:1px solid rgba(255,255,255,0.07); }
        .pulse-ring { animation: pr 2s ease-in-out infinite; }
        @keyframes pr { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.4;transform:scale(1.4);} }
      `}</style>

      <div className="max-w-[1400px] mx-auto px-6 py-7 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.2))', border: '1px solid rgba(99,102,241,0.4)', boxShadow: '0 0 25px rgba(99,102,241,0.3)' }}>
                <Zap className="h-5 w-5 text-violet-300" />
              </div>
              <h1 className="text-2xl font-black text-white">Live Monitor</h1>
              {liveRooms > 0 && (
                <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5"
                  style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <span className="relative flex h-2 w-2">
                    <span className="pulse-ring animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-xs font-black text-emerald-400">{liveRooms} room{liveRooms > 1 ? 's' : ''} live</span>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-500">Select an exam room to monitor. Each room requires your Monitor Key.</p>
          </div>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => void refresh()}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-slate-400 hover:text-white lml-glass transition-all">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </motion.button>
        </div>

        {/* ── Global stat bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Live Rooms', value: liveRooms, icon: DoorOpen, col: '#818cf8' },
            { label: 'Active Students', value: totalActive, icon: Users, col: '#60a5fa' },
            { label: 'Critical Alerts', value: totalCritical, icon: AlertCircle, col: totalCritical > 0 ? '#f87171' : '#4ade80' },
            { label: 'Avg Integrity', value: liveMonitor.stats.avg_compliance !== null ? `${Math.round(liveMonitor.stats.avg_compliance)}%` : 'N/A', icon: Shield, col: '#22c55e' },
          ].map(({ label, value, icon: Icon, col }) => (
            <div key={label} className="lml-card rounded-2xl p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${col}18`, border: `1px solid ${col}25` }}>
                <Icon className="h-4.5 w-4.5" style={{ color: col }} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{label}</p>
                <p className="text-xl font-black text-white">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter chips ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'active', 'upcoming', 'ended'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className="px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all duration-150"
              style={{
                background: statusFilter === f ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                border: statusFilter === f ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                color: statusFilter === f ? '#a5b4fc' : '#64748b',
              }}>{f}</button>
          ))}
          <span className="ml-2 text-xs text-slate-600">{filteredRooms.length} of {rooms.length} exam{rooms.length !== 1 ? 's' : ''}</span>
        </div>

        {/* ── Room cards grid ── */}
        {isLoading && rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center lml-glass">
              <RefreshCw className="h-7 w-7 animate-spin text-violet-400" />
            </div>
            <p className="text-sm text-slate-500">Loading exam rooms...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <AlertCircle className="h-10 w-10 text-rose-400" />
            <p className="text-sm text-slate-500">{error}</p>
            <button onClick={() => void refresh()} className="text-xs font-bold text-violet-400 hover:text-violet-300">Retry</button>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <DoorOpen className="h-12 w-12 text-slate-700" />
            <p className="text-sm text-slate-600">No {statusFilter !== 'all' ? statusFilter : ''} exam rooms found</p>
            {statusFilter !== 'all' && (
              <button onClick={() => setStatusFilter('all')} className="text-xs font-bold text-violet-400">Show all rooms</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredRooms.map((room, i) => (
                <ExamRoomCard key={room.exam_id} room={room} index={i} onEnter={handleEnterRoom} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Room Key Modal ── */}
      <AnimatePresence>
        {keyModalRoom && (
          <RoomKeyModal
            examId={keyModalRoom.exam_id}
            examTitle={keyModalRoom.title}
            onSuccess={() => { setSelectedRoom(keyModalRoom); setKeyModalRoom(null); }}
            onClose={() => setKeyModalRoom(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
