import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  addNewLabel?: string;
  onAddNew?: () => void;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  searchPlaceholder = 'Search...',
  emptyText = 'No matching options',
  addNewLabel,
  onAddNew,
  disabled = false,
  hasError = false,
  id,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  }, [options, query]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`w-full px-3 py-2 text-xs text-left bg-white border rounded-md flex items-center justify-between gap-2 transition-colors focus:outline-none ${
          hasError
            ? 'border-red-400 focus:border-red-500 ring-1 ring-red-200'
            : open
              ? 'border-[#2563EB] ring-2 ring-[#2563EB]/15'
              : 'border-slate-300 hover:border-slate-400'
        } ${disabled ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate ${selectedOption || value ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
          {selectedOption ? selectedOption.label : value || placeholder}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100 bg-slate-50/70">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-[#2563EB] text-slate-900"
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-400">{emptyText}</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 text-[#2563EB] font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 truncate">
                      <span className="truncate">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="ml-1.5 text-[11px] text-slate-400">{opt.sublabel}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {addNewLabel && onAddNew && (
            <div className="border-t border-slate-100 bg-slate-50 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddNew();
                }}
                className="w-full px-2.5 py-1.5 rounded-md text-xs font-semibold text-[#2563EB] hover:bg-blue-50 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{addNewLabel}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
