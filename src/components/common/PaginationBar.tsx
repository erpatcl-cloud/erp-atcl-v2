import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize);

  if (totalItems <= pageSize) return null;

  return (
    <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <div className="font-mono">
        Showing <strong>{start}</strong>–<strong>{end}</strong> of <strong>{totalItems}</strong> records
      </div>
      <div className="inline-flex items-center gap-1.5">
        <button
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Prev
        </button>
        <span className="font-mono px-2">
          Page {safePage} / {totalPages}
        </span>
        <button
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
