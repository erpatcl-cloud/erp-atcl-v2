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
  const toneStyles = {
    blue: {
      card: 'bg-gradient-to-br from-sky-50/90 via-cyan-50/40 to-white border-sky-200/75 hover:border-sky-300',
      icon: 'bg-sky-100/80 text-sky-600',
      value: 'text-sky-600',
    },
    emerald: {
      card: 'bg-gradient-to-br from-emerald-50/90 via-teal-50/40 to-white border-emerald-200/75 hover:border-emerald-300',
      icon: 'bg-emerald-100/80 text-emerald-600',
      value: 'text-emerald-600',
    },
    amber: {
      card: 'bg-gradient-to-br from-amber-50/90 via-orange-50/40 to-white border-amber-200/75 hover:border-amber-300',
      icon: 'bg-amber-100/80 text-amber-600',
      value: 'text-amber-600',
    },
    purple: {
      card: 'bg-gradient-to-br from-violet-50/90 via-purple-50/40 to-white border-violet-200/75 hover:border-violet-300',
      icon: 'bg-violet-100/80 text-violet-600',
      value: 'text-violet-600',
    },
    rose: {
      card: 'bg-gradient-to-br from-rose-50/90 via-pink-50/40 to-white border-rose-200/75 hover:border-rose-300',
      icon: 'bg-rose-100/80 text-rose-600',
      value: 'text-rose-600',
    },
    slate: {
      card: 'bg-gradient-to-br from-slate-50/95 via-slate-50/50 to-white border-slate-200/85 hover:border-slate-300',
      icon: 'bg-slate-100 text-slate-600',
      value: 'text-slate-800',
    },
  };

  const style = toneStyles[tone];

  return (
    <div
      title={tooltip}
      className={`rounded-2xl border p-4 sm:p-5 shadow-xs transition-all hover:shadow-sm ${style.card}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600/90">
          {label}
        </span>
        {icon && (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${style.icon}`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-2.5">
        <div className={`text-xl sm:text-2xl font-extrabold tracking-tight font-mono tabular-nums ${style.value}`}>
          {value}
        </div>
        {subValue && (
          <p className="mt-1 text-[11px] text-slate-500 font-medium truncate">
            {subValue}
          </p>
        )}
      </div>
    </div>
  );
};
