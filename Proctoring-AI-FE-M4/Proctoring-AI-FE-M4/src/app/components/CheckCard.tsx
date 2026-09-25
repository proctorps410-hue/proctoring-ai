import { ReactNode } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";

interface CheckCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  action: ReactNode;
  children?: ReactNode;
  stepNumber?: number;
}

export function CheckCard({
  icon: Icon,
  title,
  description,
  checked,
  disabled = false,
  action,
  children,
  stepNumber,
}: CheckCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: disabled ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`group relative rounded-xl border bg-white transition-all duration-300 ${
        checked
          ? "border-emerald-200 shadow-sm shadow-emerald-50"
          : disabled
          ? "border-gray-100 bg-gray-50/50"
          : "border-gray-200 hover:border-emerald-200 hover:shadow-sm"
      }`}
    >
      {/* Success accent bar */}
      {checked && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-emerald-500" />
      )}

      <div className="flex items-center justify-between p-5 gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Step indicator + icon */}
          <div className="relative flex-shrink-0">
            {stepNumber && (
              <span
                className={`absolute -top-1.5 -left-1.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] z-10 ${
                  checked
                    ? "bg-emerald-500 text-white"
                    : disabled
                    ? "bg-gray-300 text-white"
                    : "bg-gray-400 text-white"
                }`}
              >
                {checked ? <Check className="w-2.5 h-2.5" /> : stepNumber}
              </span>
            )}
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors duration-300 ${
                checked
                  ? "bg-emerald-50 text-emerald-600"
                  : disabled
                  ? "bg-gray-100 text-gray-400"
                  : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {checked && !stepNumber ? (
                <Check className="w-5 h-5" />
              ) : (
                <Icon className="w-5 h-5" />
              )}
            </div>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <h4
              className={`text-[14px] mb-0.5 ${
                disabled ? "text-gray-400" : "text-gray-900"
              }`}
            >
              {title}
            </h4>
            <p
              className={`text-[13px] ${
                disabled ? "text-gray-400" : "text-gray-500"
              }`}
            >
              {description}
            </p>
          </div>
        </div>

        {/* Action */}
        <div className="flex-shrink-0">{action}</div>
      </div>

      {/* Optional child content (errors, results, etc.) */}
      {children && <div className="px-5 pb-5 -mt-1">{children}</div>}
    </motion.div>
  );
}

// Reusable action button
interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  completed?: boolean;
  label: string;
  completedLabel: string;
}

export function ActionButton({
  onClick,
  disabled = false,
  completed = false,
  label,
  completedLabel,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || completed}
      className={`px-4 py-2 rounded-lg text-[13px] transition-all duration-200 cursor-pointer ${
        completed
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : disabled
          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
          : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.97] shadow-sm"
      }`}
    >
      {completed ? (
        <span className="flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          {completedLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

// Section header
interface SectionHeaderProps {
  title: string;
  description?: string;
  badge?: string;
}

export function SectionHeader({ title, description, badge }: SectionHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <h3 className="text-[15px] text-gray-900">{title}</h3>
        {badge && (
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[11px] text-gray-500 uppercase tracking-wider">
            {badge}
          </span>
        )}
      </div>
      {description && (
        <p className="text-[13px] text-gray-500 mt-0.5">{description}</p>
      )}
    </div>
  );
}

// Error message
interface ErrorMessageProps {
  message: string;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="ml-15 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
      <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
      <p className="text-[13px] text-red-600">{message}</p>
    </div>
  );
}
