/**
 * TimeNavigationBar — Earlier · clock · Later + refresh for the board
 */

interface TimeNavigationBarProps {
  timeWindowOffset: number;
  displayTime: string;
  isLoading: boolean;
  relativeTime: string;
  lastRefreshed: Date | null;
  onEarlier: () => void;
  onLater: () => void;
  onNow: () => void;
  onRefresh: () => void;
}

export function TimeNavigationBar({
  timeWindowOffset,
  displayTime,
  isLoading,
  relativeTime,
  lastRefreshed,
  onEarlier,
  onLater,
  onNow,
  onRefresh,
}: TimeNavigationBarProps) {
  return (
    <div className="flex items-center justify-between px-2 py-4 border-b border-border-default bg-surface-page">
      {/* Left: Earlier */}
      <button
        onClick={onEarlier}
        className="px-6 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-blue-500"
        aria-label="Show earlier trains"
      >
        Earlier
      </button>

      {/* Centre: clock time + live indicator + refresh (merged button) */}
      <div className="flex items-center gap-0">
        <button
          onClick={() => {
            if (timeWindowOffset !== 0) onNow();
          }}
          disabled={timeWindowOffset === 0}
          className={`text-xl font-mono font-semibold tabular-nums pl-2 pr-1 py-1 rounded select-none focus-visible:ring-1 focus-visible:ring-blue-500 flex items-center gap-1.5 ${
            timeWindowOffset === 0
              ? "text-text-primary cursor-default"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-hover cursor-pointer"
          }`}
          aria-label={timeWindowOffset === 0 ? "Live time" : "Return to live"}
        >
          {timeWindowOffset === 0 && (
            <span
              className="w-2 h-2 rounded-full shrink-0 bg-status-on-time animate-pulse-subtle"
              style={{ boxShadow: "var(--glow-live)" }}
            />
          )}
          {displayTime}
        </button>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`text-sm select-none transition-colors duration-300 text-text-muted hover:text-text-primary pr-2 pl-1
             py-1 min-h-9 flex items-center gap-0 focus-visible:ring-2 focus-visible:ring-blue-500 rounded`}
          aria-label="Refresh board"
          title={timeWindowOffset === 0 && lastRefreshed ? `Refreshed ${relativeTime}` : "Refresh"}
        >
          {timeWindowOffset === 0 && lastRefreshed && (
            <span className="text-xs text-text-muted font-mono tabular-nums">{relativeTime}</span>
          )}{" "}
          <span className={`pl-1 ${isLoading ? "animate-spin" : ""}`}>↻</span>
        </button>
      </div>

      {/* Right: Later */}
      <button
        onClick={onLater}
        className="px-6 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-blue-500"
        aria-label="Show later trains"
      >
        Later
      </button>
    </div>
  );
}