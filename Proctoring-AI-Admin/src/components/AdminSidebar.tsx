
import { motion } from 'motion/react';
import { Monitor, FileEdit, Settings, Shield, BarChart3 } from 'lucide-react';

interface AdminSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const navigationItems = [
  { name: 'Live Monitor', icon: Monitor },
  { name: 'Results Dashboard', icon: BarChart3 },
  { name: 'Exam Creator', icon: FileEdit },
  { name: 'Settings', icon: Settings },
];

export function AdminSidebar({ activeTab, setActiveTab }: AdminSidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-20 h-screen w-72 border-r border-slate-200 bg-white shadow-lg">
      {/* Logo Section */}
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/50">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Command Center</h2>
            <p className="text-xs text-cyan-600">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="p-4">
        <div className="space-y-2">
          {navigationItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeTab === item.name;

            return (
              <motion.button
                key={item.name}
                onClick={() => setActiveTab(item.name)}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ x: 4 }}
                className={`group relative w-full overflow-hidden rounded-xl p-4 text-left transition-all duration-300 ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-slate-900 shadow-lg shadow-cyan-500/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-cyan-400 to-blue-500"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}

                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-5 w-5 transition-colors ${
                      isActive ? 'text-cyan-600' : 'text-slate-400 group-hover:text-cyan-600'
                    }`}
                  />
                  <span className="font-medium">{item.name}</span>
                </div>

                {/* Hover glow effect */}
                {!isActive && (
                  <div className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-blue-500/5" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </nav>

      {/* Status Indicator */}
      <div className="absolute bottom-6 left-4 right-4">
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="relative">
              <div className="h-3 w-3 rounded-full bg-green-500" />
              <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-green-500 opacity-75" />
            </div>
            <span className="text-sm font-medium text-slate-900">System Status</span>
          </div>
          <p className="text-xs text-slate-600">All servers operational</p>
        </div>
      </div>
    </aside>
  );
}
