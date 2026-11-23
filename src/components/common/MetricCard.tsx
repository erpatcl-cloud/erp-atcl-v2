import React, { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: ReactNode;
  tone?: 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'slate';
  tooltip?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subValue,
  icon,
  tone = 'blue',
  tooltip,
}) => {
  const iconBgMap = {
    blue: 'bg-blue-100/80 text-blue-600',
    emerald: 'bg-emerald-100/80 text-emerald-600',
    amber: 'bg-amber-100/80 text-amber-600',
    purple: 'bg-purple-100/80 text-purple-600',
    rose: 'bg-rose-100/80 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  };

  return (
    <div
      title={tooltip}
      className="bg-white rounded-xl border border-slate-200/90 p-4 sm:p-5 shadow-xs transition-all hover:border-slate-300"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon && (
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBgMap[tone]}`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 font-mono tabular-nums">
          {value}
        </div>
        {subValue && (
          <p className="mt-1 text-xs text-slate-500 font-medium truncate">
            {subValue}
          </p>
        )}
      </div>
    </div>
  );
};
