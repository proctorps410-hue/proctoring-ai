
import { motion } from 'motion/react';
import { Users, AlertTriangle, TrendingUp, Server } from 'lucide-react';

const stats = [
  {
    label: 'Active Students',
    value: '124',
    icon: Users,
    color: 'from-cyan-500 to-blue-500',
    shadowColor: 'shadow-cyan-500/50',
    bgGlow: 'bg-cyan-500/10',
  },
  {
    label: 'Red Flags',
    value: '5',
    icon: AlertTriangle,
    color: 'from-red-500 to-orange-500',
    shadowColor: 'shadow-red-500/50',
    bgGlow: 'bg-red-500/10',
  },
  {
    label: 'Avg Compliance',
    value: '92%',
    icon: TrendingUp,
    color: 'from-green-500 to-emerald-500',
    shadowColor: 'shadow-green-500/50',
    bgGlow: 'bg-green-500/10',
  },
  {
    label: 'Servers Online',
    value: '8/8',
    icon: Server,
    color: 'from-purple-500 to-pink-500',
    shadowColor: 'shadow-purple-500/50',
    bgGlow: 'bg-purple-500/10',
  },
];

export function StatsBar() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ y: -4 }}
            className="group relative"
          >
            {/* Glow effect */}
            <div
              className={`absolute -inset-[1px] rounded-xl bg-gradient-to-r ${stat.color} opacity-50 blur-sm transition-opacity duration-300 group-hover:opacity-75`}
            />

            {/* Card content */}
            <div className="relative rounded-xl border border-slate-200 bg-white p-6 shadow-lg transition-all duration-300">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="mb-1 text-sm font-medium text-slate-600">{stat.label}</p>
                  <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
                </div>
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${stat.color} ${stat.shadowColor} shadow-lg`}
                >
                  <Icon className="h-6 w-6 text-white" />
                </div>
              </div>

              {/* Subtle glow on hover */}
              <div className={`absolute inset-0 -z-10 rounded-xl ${stat.bgGlow} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}