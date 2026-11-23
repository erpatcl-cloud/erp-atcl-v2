import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error.',
    };
  }

  render() {
    if (this.state.hasError) {
      let displayDetail = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed?.error) {
          displayDetail = `${parsed.error}${parsed.path ? ` (${parsed.operationType} on ${parsed.path})` : ''}`;
        }
      } catch {
        // Not a JSON-formatted FirestoreErrorInfo
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
          <div className="bg-white border border-red-200 rounded-lg p-6 max-w-lg w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-red-50 text-red-700 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-slate-900">
                  Cloud &amp; Application Fault Detected
                </h1>
                <p className="text-xs text-slate-600 mt-1 break-words">{displayDetail}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Recover View</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
