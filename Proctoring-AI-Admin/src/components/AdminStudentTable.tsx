import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, ChevronDown, Loader2, Search, Filter, X, RefreshCw } from 'lucide-react';
import type {
  AdminConnectionState,
  AdminLiveSession,
  AdminRiskTier,
  AdminSessionStatus,
} from '../types/adminLiveMonitor';

type StatusFilter = 'all' | AdminSessionStatus;
type TierFilter = 'all' | AdminRiskTier;

type ReviewStudent = AdminLiveSession & {
  name: string;
  violations: number;
  examName: string;
};

interface AdminStudentTableProps {
  sessions: AdminLiveSession[];
  isLoading: boolean;
  connectionState: AdminConnectionState;
  lastUpdated: string | null;
  onReview?: (student: ReviewStudent) => void;
  onRefresh?: () => void;
}

const formatRelativeTime = (value: string | null): string => {
  if (!value) return 'No activity';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 'No activity';

  const deltaSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (deltaSeconds < 5) return 'Just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const formatLastUpdated = (value: string | null): string => {
  if (!value) return 'Waiting for updates';
  return `Last synced ${formatRelativeTime(value)}`;
};

const getTierColor = (tier: AdminRiskTier) => {
  switch (tier) {
    case 'Safe':
      return 'bg-green-500/20 text-green-600 border-green-500/30';
    case 'Watch':
      return 'bg-amber-500/20 text-amber-700 border-amber-500/30';
    case 'Flagged':
      return 'bg-orange-500/20 text-orange-700 border-orange-500/30';
    case 'Critical':
      return 'bg-red-500/20 text-red-700 border-red-500/30';
    default:
      return 'bg-slate-500/20 text-slate-500 border-slate-500/30';
  }
};

const getConnectionBadge = (connectionState: AdminConnectionState) => {
  if (connectionState === 'live') return 'bg-green-100 text-green-700 border-green-300';
  if (connectionState === 'polling') return 'bg-amber-100 text-amber-700 border-amber-300';
  if (connectionState === 'connecting') return 'bg-cyan-100 text-cyan-700 border-cyan-300';
  return 'bg-red-100 text-red-700 border-red-300';
};

const statusRank: Record<AdminSessionStatus, number> = {
  active: 0,
  offline: 1,
  completed: 2,
  terminated: 3,
};

export function AdminStudentTable({
  sessions,
  isLoading,
  connectionState,
  lastUpdated,
  onReview,
  onRefresh,
}: AdminStudentTableProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  const filteredStudents = useMemo(() => {
    const filtered = sessions.filter((student) => {
      const fullName = (student.full_name || '').toLowerCase();
      const email = (student.email || '').toLowerCase();
      const query = searchQuery.toLowerCase();

      const matchesSearch = fullName.includes(query) || email.includes(query);
      const matchesStatus = statusFilter === 'all' || student.status === statusFilter;
      const matchesTier = tierFilter === 'all' || student.tier === tierFilter;

      return matchesSearch && matchesStatus && matchesTier;
    });

    return filtered.sort((a, b) => {
      const statusDiff = statusRank[a.status] - statusRank[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.violation_count - a.violation_count;
    });
  }, [sessions, searchQuery, statusFilter, tierFilter]);

  if (isLoading && sessions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="relative"
    >
      <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-cyan-500/20 opacity-50 blur-sm" />

      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Live Examination Sessions</h2>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getConnectionBadge(connectionState)}`}>
                  {connectionState.toUpperCase()}
                </span>
                <button
                  onClick={onRefresh}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-all hover:border-cyan-400 hover:text-cyan-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">{formatLastUpdated(lastUpdated)}</p>
              <div className="flex items-center gap-2">
                <div className="group relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-cyan-500 transition-colors" />
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-64 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-all ${
                    showFilters || statusFilter !== 'all' || tierFilter !== 'all'
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-cyan-500 hover:bg-slate-50'
                  }`}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 grid grid-cols-2 gap-4 border-t border-slate-200 py-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</label>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'active', 'offline', 'completed', 'terminated'] as const).map((status) => (
                          <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              statusFilter === status
                                ? 'bg-cyan-600 text-white shadow-md'
                                : 'border border-slate-200 bg-white text-slate-600 hover:border-cyan-300'
                            }`}
                          >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Risk Tier</label>
                      <div className="flex flex-wrap gap-2">
                        {(['all', 'Safe', 'Watch', 'Flagged', 'Critical'] as const).map((tier) => (
                          <button
                            key={tier}
                            onClick={() => setTierFilter(tier)}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              tierFilter === tier
                                ? 'bg-cyan-600 text-white shadow-md'
                                : 'border border-slate-200 bg-white text-slate-600 hover:border-cyan-300'
                            }`}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-sm font-medium text-slate-600">
                <th className="px-6 py-4 text-left">Student</th>
                <th className="px-6 py-4 text-left">Exam</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-center">Last Active</th>
                <th className="px-6 py-4 text-center">Violations</th>
                <th className="px-6 py-4 text-center">Tier</th>
                <th className="px-6 py-4 text-center">Progress</th>
                <th className="px-6 py-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length > 0 ? (
                filteredStudents.map((student, index) => {
                  const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(student.email)}`;
                  const statusLabel = student.status.charAt(0).toUpperCase() + student.status.slice(1);
                  const progress = Math.min(100, Math.max(0, Math.round(student.progress)));

                  return (
                    <motion.tr
                      key={student.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + index * 0.03 }}
                      onMouseEnter={() => setHoveredRow(student.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`border-b border-slate-100 transition-all duration-200 ${hoveredRow === student.id ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <img
                              src={avatar}
                              alt={student.full_name}
                              className="h-10 w-10 rounded-full border-2 border-slate-200 bg-slate-100"
                            />
                            {student.status === 'active' && (
                              <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white">
                                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{student.full_name}</p>
                            <p className="text-xs text-slate-500">{student.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-700">{student.exam_title || 'N/A'}</p>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          {student.status === 'active' ? (
                            <>
                              <div className="relative">
                                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                                <div className="absolute inset-0 h-2.5 w-2.5 animate-ping rounded-full bg-green-500 opacity-75" />
                              </div>
                              <span className="text-sm font-medium text-green-600">Active</span>
                            </>
                          ) : (
                            <>
                              <div className={`h-2.5 w-2.5 rounded-full ${student.status === 'terminated' ? 'bg-red-500' : student.status === 'completed' ? 'bg-blue-500' : 'bg-slate-500'}`} />
                              <span className={`text-sm font-medium ${student.status === 'terminated' ? 'text-red-600' : student.status === 'completed' ? 'text-blue-600' : 'text-slate-500'}`}>
                                {statusLabel}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 text-center text-sm text-slate-600">
                        {formatRelativeTime(student.last_active)}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          {student.violation_count > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-600 ring-1 ring-red-500/30">
                              {student.violation_count}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-500">-</span>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getTierColor(student.tier)}`}>
                            {student.tier}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600">{progress}%</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() =>
                              onReview?.({
                                ...student,
                                name: student.full_name,
                                violations: student.violation_count,
                                examName: student.exam_title || 'N/A',
                              })
                            }
                            className="group relative flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-cyan-500/30 transition-all duration-200 hover:shadow-cyan-500/50"
                          >
                            <Eye className="h-4 w-4" />
                            Review
                            <div className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                          </motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Search className="h-8 w-8 text-slate-300" />
                      <p>No students found matching your filters.</p>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setStatusFilter('all');
                          setTierFilter('all');
                        }}
                        className="font-medium text-cyan-600 hover:underline"
                      >
                        Clear all filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <p>Showing {filteredStudents.length} of {sessions.length} sessions</p>
            <p>{formatLastUpdated(lastUpdated)}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
