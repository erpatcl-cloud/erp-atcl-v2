import type {
  AppThemePreset,
  CustomInstructionsStyle,
  UiDensityMode,
} from '../types/accounting.ts';

export interface ThemePresetMeta {
  id: AppThemePreset;
  label: string;
  description: string;
  defaultAccent: string;
  canvasPreview: string;
  surfacePreview: string;
  isDark: boolean;
}

export const THEME_PRESETS: ThemePresetMeta[] = [
  {
    id: 'atcl-navy',
    label: 'ATCL Classic Navy',
    description: 'Cool crisp ledger canvas with deep corporate navy accents',
    defaultAccent: '#1F4E79',
    canvasPreview: '#F7F9FC',
    surfacePreview: '#FFFFFF',
    isDark: false,
  },
  {
    id: 'warm-ivory',
    label: 'Warm Ivory Ledger',
    description: 'Soft archival paper canvas tuned for long audit review sessions',
    defaultAccent: '#1E4631',
    canvasPreview: '#FAF8F3',
    surfacePreview: '#FFFDF9',
    isDark: false,
  },
  {
    id: 'slate-dark',
    label: 'Slate Executive Dark',
    description: 'Low-glare dark slate surfaces with WCAG-balanced contrast',
    defaultAccent: '#3B82F6',
    canvasPreview: '#0B1220',
    surfacePreview: '#111A2E',
    isDark: true,
  },
  {
    id: 'high-contrast',
    label: 'High-Contrast Audit',
    description: 'Pure white paper with crisp charcoal hairlines for statutory review',
    defaultAccent: '#0F172A',
    canvasPreview: '#FFFFFF',
    surfacePreview: '#F8FAFC',
    isDark: false,
  },
];

export function applyCustomStyleToDocument(style?: Partial<CustomInstructionsStyle> | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme: AppThemePreset = style?.themePreset || 'atcl-navy';
  const density: UiDensityMode = style?.density || 'standard';
  const accent = style?.accentHex && /^#[0-9a-fA-F]{6}$/.test(style.accentHex)
    ? style.accentHex
    : '#1F4E79';
  const tabularEmphasis = style?.tabularEmphasis ?? true;

  root.setAttribute('data-theme', theme);
  root.setAttribute('data-density', density);
  root.setAttribute('data-tabular', tabularEmphasis ? 'strict' : 'standard');
  root.style.setProperty('--erp-accent', accent);

  if (theme === 'slate-dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
