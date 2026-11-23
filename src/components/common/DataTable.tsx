import React, { ReactNode, useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

export interface Column<T> {
  header: ReactNode;
  accessor?: keyof T | ((row: T, index: number) => ReactNode);
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  searchPlaceholder?: string;
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  filterComponent?: ReactNode;
  actionButton?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  searchPlaceholder = 'Search records...',
  searchQuery,
  onSearchChange,
  filterComponent,
  actionButton,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your search criteria or create a new entry.',
  pageSize = 15,
  onRowClick,
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState('');
  const [page, setPage] = useState(1);

  const effectiveSearch = searchQuery !== undefined ? searchQuery : internalSearch;
  const handleSearch = (val: string) => {
    if (onSearchChange) {
      onSearchChange(val);
    } else {
      setInternalSearch(val);
    }
    setPage(1);
  };

  const totalPages = Math.ceil(data.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageData = data.slice(startIndex, startIndex + pageSize);

  return (
    <div className="bg-white rounded-lg border border-[#001F60] shadow-xs overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 max-w-xl">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={effectiveSearch ?? ''}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-1.5 sm:py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all text-slate-900 placeholder:text-slate-400"
            />
            {effectiveSearch && (
              <button
                type="button"
                onClick={() => handleSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 px-1"
              >
                Clear
              </button>
            )}
          </div>
          {filterComponent}
        </div>

        {actionButton && <div className="shrink-0">{actionButton}</div>}
      </div>

      {/* Table Scroll Area */}
      <div className="overflow-x-auto w-full">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-[#001F60] text-white text-xs font-bold">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`py-2.5 px-3 border border-[#001F60] font-bold text-xs text-white whitespace-nowrap ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                  } ${col.className || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white text-xs text-slate-800">
            {pageData.length > 0 ? (
              pageData.map((row, rIdx) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`bg-white transition-colors hover:bg-blue-50/40 ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-2 px-3 border border-[#001F60]/35 whitespace-nowrap ${
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                      } ${col.className || ''}`}
                    >
                      {typeof col.accessor === 'function'
                        ? col.accessor(row, startIndex + rIdx)
                        : col.accessor
                        ? (row[col.accessor] as ReactNode)
                        : null}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="py-12 px-4 text-center">
                  <div className="max-w-sm mx-auto">
                    <div className="text-sm font-semibold text-slate-700">{emptyTitle}</div>
                    <p className="text-xs text-slate-500 mt-1">{emptyDescription}</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <span className="font-semibold text-slate-700">{startIndex + 1}</span> to{' '}
            <span className="font-semibold text-slate-700">
              {Math.min(startIndex + pageSize, data.length)}
            </span>{' '}
            of <span className="font-semibold text-slate-700">{data.length}</span> records
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono font-semibold text-slate-700">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
