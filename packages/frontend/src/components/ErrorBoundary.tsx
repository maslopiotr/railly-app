/**
 * ErrorBoundary — Catches unhandled React render errors to prevent full app crash
 *
 * Displays a user-friendly error message with a retry button.
 * Wraps the entire app at the root level in App.tsx.
 *
 * BUG-017: Any unhandled render error previously crashed the entire SPA.
 * This boundary ensures the user sees a recovery UI instead of a blank screen.
 */

import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI — defaults to built-in recovery message */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to console for debugging — could be extended to send to error tracking service
    console.error("[ErrorBoundary] Unhandled render error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 max-w-md">
            An unexpected error occurred while rendering this page. Your data is safe — try retrying or reloading the page.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Try again
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Reload page
            </button>
          </div>
          {this.state.error && (
            <details className="mt-4 text-left max-w-md">
              <summary className="text-xs text-gray-400 dark:text-slate-500 cursor-pointer">
                Error details
              </summary>
              <pre className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}