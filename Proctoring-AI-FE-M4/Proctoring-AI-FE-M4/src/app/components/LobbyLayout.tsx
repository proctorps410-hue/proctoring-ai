import { ReactNode } from "react";
import { motion } from "motion/react";
import "../../styles/tailwind.css";
import "../../styles/lobby.css";

import {
  Shield,
  MonitorCheck,
  Wifi,
  CheckCircle2,
  Circle,
  Clock,
  HelpCircle,
} from "lucide-react";

interface LobbyLayoutProps {
  children: ReactNode;
  currentStep: 1 | 2;
  stepOneComplete?: boolean;
  stepTwoComplete?: boolean;
  examData?: {
    title?: string;
    id?: string | number;
    duration_minutes?: number;
  };
  userData?: {
    full_name?: string;
    email?: string;
    id?: string | number;
  };
}

const steps = [
  {
    number: 1,
    title: "System Check",
    description: "Browser & permissions",
    icon: MonitorCheck,
  },
  {
    number: 2,
    title: "Network Check",
    description: "Connectivity & config",
    icon: Wifi,
  },
];

export function LobbyLayout({
  children,
  currentStep,
  stepOneComplete = false,
  stepTwoComplete = false,
  examData,
  userData,
}: LobbyLayoutProps) {
  const stepStatus = [stepOneComplete, stepTwoComplete];
  
  // Safe fallbacks
  const examTitle = examData?.title || 'Loading Exam...';
  const examCode = examData?.id ? `EXAM-${String(examData.id).padStart(3, '0')}` : '---';
  const duration = examData?.duration_minutes ? `${examData.duration_minutes} minutes` : '---';
  
  const studentName = userData?.full_name || 'Loading...';
  const studentId = userData?.id ? `STU-${userData.id}` : 'STU----';
  const studentInitials = studentName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'ST';

  return (
    <div className="lobby-root">
    <div
      className="min-h-screen w-full flex"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Sidebar */}
      <aside className="hidden lg:flex w-[300px] flex-col bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 text-white relative overflow-hidden flex-shrink-0">
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-5">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col h-full">
          {/* Logo area */}
          <div className="px-7 pt-8 pb-6">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <Shield className="w-5 h-5 text-slate-300" />
              </div>
              <div>
                <h1 className="text-[18px] tracking-tight text-white">
                  ExamGuard
                </h1>
                <p className="text-[11px] text-slate-400 tracking-widest uppercase">
                  Secure Proctoring
                </p>
              </div>
            </div>
          </div>

          <div className="mx-7 border-t border-slate-700/50" />

          {/* Exam info */}
          <div className="px-7 py-5">
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
              <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                Exam Session
              </p>
              <p className="text-[15px] text-white mb-1">
                {examTitle}
              </p>
              <p className="text-[13px] text-slate-400">{examCode}</p>
              <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-500">
                <Clock className="w-3.5 h-3.5" />
                <span>Duration: {duration}</span>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="px-7 py-4 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-5">
              Pre-exam Checklist
            </p>
            <div className="space-y-1">
              {steps.map((step, idx) => {
                const isActive = currentStep === step.number;
                const isComplete = stepStatus[idx];
                const StepIcon = step.icon;

                return (
                  <div key={step.number} className="relative">
                    {/* Connector line */}
                    {idx < steps.length - 1 && (
                      <div
                        className={`absolute left-[19px] top-[48px] w-[2px] h-[16px] transition-colors duration-300 ${
                          isComplete ? "bg-emerald-500" : "bg-slate-700/50"
                        }`}
                      />
                    )}
                    <div
                      className={`flex items-center gap-3.5 px-3 py-3 rounded-xl transition-all duration-300 ${
                        isActive
                          ? "bg-white/10 backdrop-blur-sm"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <div
                        className={`w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                          isComplete
                            ? "bg-emerald-500 text-white"
                            : isActive
                            ? "bg-white/10 text-white ring-2 ring-slate-500/50"
                            : "bg-slate-800/60 text-slate-500"
                        }`}
                      >
                        {isComplete ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <StepIcon className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[14px] ${
                            isActive || isComplete
                              ? "text-white"
                              : "text-slate-400"
                          }`}
                        >
                          {step.title}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          {step.description}
                        </p>
                      </div>
                      {isComplete && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                          Done
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom help */}
          <div className="px-7 pb-7">
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/40 border border-slate-700/30 cursor-pointer hover:bg-slate-800/60 transition-colors">
              <HelpCircle className="w-4.5 h-4.5 text-slate-400" />
              <div>
                <p className="text-[13px] text-slate-300">Need help?</p>
                <p className="text-[11px] text-slate-500">
                  Contact support
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-gray-50/80 min-h-screen">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200/80 px-6 lg:px-10 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-[15px] text-gray-900">ExamGuard</span>
          </div>
          <div className="hidden lg:block">
            <h2 className="text-[18px] text-gray-900">
              {currentStep === 1
                ? "System Requirements Check"
                : "Network & Final Checks"}
            </h2>
            <p className="text-[13px] text-gray-500 mt-0.5">
              Step {currentStep} of 2 — Complete all checks before starting your
              exam
            </p>
          </div>

          {/* Mobile step indicator */}
          <div className="lg:hidden flex items-center gap-2">
            {steps.map((step, idx) => (
              <div
                key={step.number}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  stepStatus[idx]
                    ? "bg-emerald-500"
                    : currentStep === step.number
                    ? "bg-emerald-400 ring-4 ring-emerald-100"
                    : "bg-gray-300"
                }`}
              />
            ))}
          </div>

          {/* User area */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-[13px] text-gray-700">{studentName}</p>
              <p className="text-[11px] text-gray-400">Student ID: {studentId}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[13px]">
              {studentInitials}
            </div>
          </div>
        </header>

        {/* Progress bar */}
        <div className="h-1 bg-gray-200/80 flex-shrink-0">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
            initial={{ width: currentStep === 1 ? "0%" : "50%" }}
            animate={{
              width:
                stepTwoComplete
                  ? "100%"
                  : stepOneComplete
                  ? "50%"
                  : currentStep === 1
                  ? "10%"
                  : "50%",
            }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 sm:px-8 lg:px-10 py-8">
            {/* Mobile title */}
            <div className="lg:hidden mb-6">
              <h2 className="text-[18px] text-gray-900">
                {currentStep === 1
                  ? "System Requirements Check"
                  : "Network & Final Checks"}
              </h2>
              <p className="text-[13px] text-gray-500 mt-0.5">
                Step {currentStep} of 2
              </p>
            </div>

            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
    </div>
  );
}