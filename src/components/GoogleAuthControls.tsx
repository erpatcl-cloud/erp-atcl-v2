import React from 'react';
import { AlertTriangle, LogOut, ShieldCheck, X } from 'lucide-react';
import type { User } from 'firebase/auth';

interface GoogleSignInButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onClick,
  disabled = false,
  label = 'Sign in with Google',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="gsi-material-button"
    >
      <div className="gsi-material-button-state" />
      <div className="gsi-material-button-content-wrapper">
        <div className="gsi-material-button-icon">
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            className="block w-full h-full"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
        </div>
        <span className="gsi-material-button-contents">{label}</span>
        <span className="sr-only">{label}</span>
      </div>
    </button>
  );
};

interface GoogleUserBadgeProps {
  user: User;
  hasWorkspaceToken: boolean;
  onReconnectToken: () => void;
  onSignOut: () => void;
  busy?: boolean;
}

export const GoogleUserBadge: React.FC<GoogleUserBadgeProps> = ({
  user,
  hasWorkspaceToken,
  onReconnectToken,
  onSignOut,
  busy = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs">
      {user.photoURL ? (
        <img
          src={user.photoURL}
          alt={user.displayName || 'Google User'}
          className="w-5 h-5 rounded-full object-cover shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
          {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="hidden xl:flex flex-col leading-tight min-w-0">
        <span className="font-medium text-slate-800 dark:text-slate-100 truncate max-w-[120px]">
          {user.displayName || user.email}
        </span>
        <span className="text-[10px] text-slate-500">
          {hasWorkspaceToken ? 'Workspace Connected' : 'Firebase Active · Token Needed'}
        </span>
      </div>
      {!hasWorkspaceToken && (
        <button
          type="button"
          onClick={onReconnectToken}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] font-semibold text-[#2563EB] bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
        >
          Authorize
        </button>
      )}
      <button
        type="button"
        onClick={onSignOut}
        disabled={busy}
        title="Sign out of Google & Firebase"
        className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export interface PendingConfirmation {
  title: string;
  serviceLabel: string;
  description: string;
  affectedItems?: string[];
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

interface WorkspaceConfirmModalProps {
  pending: PendingConfirmation | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const WorkspaceConfirmModal: React.FC<WorkspaceConfirmModalProps> = ({
  pending,
  busy,
  onCancel,
  onConfirm,
}) => {
  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ws-confirm-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-1.5 rounded-md ${
                pending.destructive
                  ? 'bg-red-50 text-red-600'
                  : 'bg-[#DBEAFE] text-[#2563EB]'
              }`}
            >
              {pending.destructive ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {pending.serviceLabel}
              </div>
              <h3 id="ws-confirm-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {pending.title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel action"
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {pending.description}
          </p>

          {pending.affectedItems && pending.affectedItems.length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-3 space-y-1 max-h-36 overflow-y-auto">
              <div className="text-[11px] font-semibold text-slate-500">
                Target Scope ({pending.affectedItems.length})
              </div>
              <ul className="text-xs font-mono text-slate-700 dark:text-slate-200 space-y-0.5">
                {pending.affectedItems.map((item, idx) => (
                  <li key={idx} className="truncate">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 text-xs font-semibold text-white rounded-md cursor-pointer disabled:opacity-60 ${
              pending.destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#2563EB] hover:bg-[#1D4ED8]'
            }`}
          >
            {busy ? 'Executing...' : pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
