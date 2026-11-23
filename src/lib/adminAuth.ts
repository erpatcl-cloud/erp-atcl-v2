export interface AdminSession {
  email: string;
  displayName: string;
  role: 'admin';
  signedInAt: string;
}

export const ADMIN_SESSION_STORAGE_KEY = 'atcl_erp_admin_session';

export const SSO_PROVIDER_FLAGS = {
  google: false,
  facebook: false,
  github: false,
  microsoft: false,
} as const;

const ALLOWED_ADMIN_EMAILS = new Set(['erpatcl@gmail.com']);

const ADMIN_PASSCODE = '123456';

export function authenticateAdminCredentials(
  email: string,
  password: string
): AdminSession | null {
  const normalized = email.trim().toLowerCase();
  if (!ALLOWED_ADMIN_EMAILS.has(normalized)) {
    return null;
  }
  if (password !== ADMIN_PASSCODE) {
    return null;
  }
  return {
    email: normalized,
    displayName: 'ATCL Admin',
    role: 'admin',
    signedInAt: new Date().toISOString(),
  };
}

export function loadAdminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (
      typeof parsed?.email === 'string' &&
      ALLOWED_ADMIN_EMAILS.has(parsed.email.toLowerCase()) &&
      parsed.role === 'admin'
    ) {
      return {
        email: parsed.email,
        displayName: parsed.displayName || 'ATCL Admin',
        role: 'admin',
        signedInAt: parsed.signedInAt || new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  try {
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
