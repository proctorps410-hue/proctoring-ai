import { useState } from 'react';
import { motion } from 'motion/react';
import { LogOut } from 'lucide-react';
import { AdminSidebar } from './AdminSidebar';
import { AdminExamCreator } from './AdminExamCreator';
import { AdminEvidenceVault } from './AdminEvidenceVault';
import { AdminResultsDashboard } from './AdminResultsDashboard';
import { AdminSettings } from './AdminSettings';
import { StudentSummaryPage } from './StudentSummaryPage';
import { LiveMonitorLobby } from './LiveMonitorLobby';

interface AdminDashboardProps {
  onLogout: () => void;
}

export function AdminDashboard({ onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState('Live Monitor');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedResultExamId, setSelectedResultExamId] = useState<number | null>(null);

  const handleReviewEvidence = (student: any) => {
    setSelectedStudent(student);
    setSelectedResultExamId(student?.examId ?? student?.exam_id ?? null);
    setActiveTab('Evidence Vault');
  };

  const handleViewSummary = (sessionId: number, examId?: number) => {
    setSelectedSessionId(sessionId);
    if (typeof examId === 'number') {
      setSelectedResultExamId(examId);
    }
    setActiveTab('Student Summary');
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Clear selections when navigating
    if (tab !== 'Evidence Vault') {
      setSelectedStudent(null);
    }
    if (tab !== 'Student Summary') {
      setSelectedSessionId(null);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white">
      {/* Main Layout */}
      <div className="relative z-10 flex min-h-screen">
        {/* Sidebar Navigation */}
        <AdminSidebar activeTab={activeTab === 'Student Summary' ? 'Results Dashboard' : activeTab} setActiveTab={handleTabChange} />

        {/* Main Content Area */}
        <main className="flex-1 pl-80">
          {/* Header - Hidden for sub-pages */}
          {activeTab !== 'Evidence Vault' && activeTab !== 'Results Dashboard' && activeTab !== 'Settings' && activeTab !== 'Student Summary' && (
            <div className="mb-8 flex items-center justify-between p-8">
              <div>
                <h1 className="mb-2 bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent">
                  {activeTab}
                </h1>
                <p className="text-slate-600">
                  {activeTab === 'Live Monitor' && 'Real-time monitoring and control center'}
                  {activeTab === 'Exam Creator' && 'Create and configure new examinations'}
                </p>
              </div>

              {/* Logout Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onLogout}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 backdrop-blur-sm transition-all hover:border-red-500/50 hover:bg-red-500/20"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </motion.button>
            </div>
          )}

          {/* Conditional Content Based on Active Tab */}
          {activeTab === 'Live Monitor' && (
            <LiveMonitorLobby onReview={handleReviewEvidence} />
          )}

          {activeTab === 'Results Dashboard' && (
            <AdminResultsDashboard
              onReviewEvidence={handleReviewEvidence}
              onViewSummary={handleViewSummary}
              initialExamId={selectedResultExamId}
              onExamSelect={setSelectedResultExamId}
            />
          )}

          {activeTab === 'Exam Creator' && (
            <div className="p-8 pt-0">
              <AdminExamCreator />
            </div>
          )}

          {activeTab === 'Evidence Vault' && (
            <AdminEvidenceVault
              student={selectedStudent}
              onBack={() => handleTabChange('Results Dashboard')}
            />
          )}

          {activeTab === 'Student Summary' && (
            <StudentSummaryPage
              sessionId={selectedSessionId}
              onBack={() => handleTabChange('Results Dashboard')}
            />
          )}

          {activeTab === 'Settings' && (
            <AdminSettings />
          )}
        </main>
      </div>
    </div>
  );
}
