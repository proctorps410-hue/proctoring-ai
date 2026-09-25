import { motion } from 'motion/react';
import { Users, AlertTriangle, TrendingUp, Server } from 'lucide-react';
import type { AdminConnectionState, AdminLiveStats } from '../types/adminLiveMonitor';

interface AdminStatsBarProps {
  stats: AdminLiveStats;
  connectionState: AdminConnectionState;
  lastUpdated: string | null;
}

const formatLastUpdated = (value: string | null): string => {
  if (!value) return 'No updates yet';

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 'Updated just now';

  const deltaSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (deltaSeconds < 5) return 'Updated just now';
  if (deltaSeconds < 60) return `Updated ${deltaSeconds}s ago`;

  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  return `Updated ${hours}h ago`;
};

const getSystemConfig = (state: AdminConnectionState) => {
  if (state === 'live') {
    return {
      value: 'Live',
      color: 'from-green-500 to-emerald-500',
      shadowColor: 'shadow-green-500/40',
      bgGlow: 'bg-green-500/10',
    };
  }
  if (state === 'polling') {
    return {
      value: 'Polling',
      color: 'from-amber-500 to-orange-500',
      shadowColor: 'shadow-amber-500/40',
      bgGlow: 'bg-amber-500/10',
    };
  }
  if (state === 'connecting') {
    return {
      value: 'Syncing',
      color: 'from-cyan-500 to-blue-500',
      shadowColor: 'shadow-cyan-500/40',
      bgGlow: 'bg-cyan-500/10',
    };
  }
  return {
    value: 'Offline',
    color: 'from-red-500 to-pink-500',
    shadowColor: 'shadow-red-500/40',
    bgGlow: 'bg-red-500/10',
  };
};

export function AdminStatsBar({ stats, connectionState, lastUpdated }: AdminStatsBarProps) {
  const systemConfig = getSystemConfig(connectionState);
  const avgCompliance =
    stats.avg_compliance === null ? 'N/A' : `${Math.round(stats.avg_compliance)}%`;

  const cards = [
    {
      label: 'Active Students',
      value: String(stats.active_students),
      icon: Users,
      color: 'from-cyan-500 to-blue-500',
      shadowColor: 'shadow-cyan-500/50',
      bgGlow: 'bg-cyan-500/10',
    },
    {
      label: 'Red Flags',
      value: String(stats.red_flags),
      icon: AlertTriangle,
      color: 'from-red-500 to-orange-500',
      shadowColor: 'shadow-red-500/50',
      bgGlow: 'bg-red-500/10',
    },
    {
      label: 'Avg Compliance',
      value: avgCompliance,
      icon: TrendingUp,
      color: 'from-green-500 to-emerald-500',
      shadowColor: 'shadow-green-500/50',
      bgGlow: 'bg-green-500/10',
    },
    {
      label: 'System Status',
      value: systemConfig.value,
      icon: Server,
      color: systemConfig.color,
      shadowColor: systemConfig.shadowColor,
      bgGlow: systemConfig.bgGlow,
    },
  ];

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>{formatLastUpdated(lastUpdated)}</span>
        <span>{stats.total_students} total students</span>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
              whileHover={{ y: -3 }}
              className="group relative"
            >
              <div className={`absolute -inset-[1px] rounded-xl bg-gradient-to-r ${card.color} opacity-45 blur-sm transition-opacity duration-300 group-hover:opacity-80`} />
              <div className="relative rounded-xl border border-slate-200 bg-white p-6 shadow-lg transition-all duration-300">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="mb-1 text-sm font-medium text-slate-600">{card.label}</p>
                    <p className="text-3xl font-bold text-slate-900">{card.value}</p>
                  </div>
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${card.color} ${card.shadowColor} shadow-lg`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div className={`absolute inset-0 -z-10 rounded-xl ${card.bgGlow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
