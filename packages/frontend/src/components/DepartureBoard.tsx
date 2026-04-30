/**
 * DepartureBoard — Hybrid timetable-first board with real-time overlay
 *
 * Shows all services for a station within a time window (past 10min + next 2hr).
 * Splits into Departures and Arrivals tabs, now server-filtered.
 * Auto-polls every 60 seconds when visible; manual refresh also available.
 * Uses semantic design tokens only — no raw Tailwind colour classes, no custom CSS.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { HybridBoardService, HybridBoardResponse, StationSearchResult } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";
import { fetchBoard } from "../api/boards";
import { ServiceRow } from "./ServiceRow";
import { TimePicker } from "./TimePicker";

interface DepartureBoardProps {
  station: StationSearchResult;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onBack?: () => void;
  onSelectService?: (service: HybridBoardService) => void;
  /** Controlled active tab — lifted to App.tsx for persistence across navigation */
  activeTab: "departures" | "arrivals";
  onTabChange: (tab: "departures" | "arrivals") => void;
  /** Selected time of day (HH:MM) or null for "now" */
  selectedTime?: string | null;
  /** Callback when user changes the time from the board view */
  onTimeChange?: (time: string | null) => void;
}

export function DepartureBoard({
  station,
  isFavourite,
  onToggleFavourite,
  onBack,
  onSelectService,
  activeTab,
  onTabChange,
  selectedTime,
  onTimeChange,
}: DepartureBoardProps) {
  const [board, setBoard] = useState<HybridBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(true); // auto-polling is active

  // Relative time string ("just now", "30s ago", "1m ago", etc.)
  const [relativeTime, setRelativeTime] = useState<string>("");

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const PULL_THRESHOLD = 60;

  // Update relative time every 10 seconds
  useEffect(() => {
    const updateRelativeTime = () => {
      if (!lastRefreshed) {
        setRelativeTime("");
        return;
      }
      const seconds = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
      if (seconds < 5) setRelativeTime("just now");
      else if (seconds < 60) setRelativeTime(`${seconds}s ago`);
      else if (seconds < 120) setRelativeTime("1m ago");
      else setRelativeTime(`${Math.floor(seconds / 60)}m ago`);
    };

    updateRelativeTime();
    const id = setInterval(updateRelativeTime, 10_000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  const loadBoard = useCallback(
    async (silent = false) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Only show loading skeleton on initial load, not on auto-poll refreshes
        if (!silent) {
          setBoard(null);
          setIsLoading(true);
        }
        const data = await fetchBoard(station.crsCode, {
          timeWindow: 120,
          pastWindow: 10,
          type: activeTab,
          time: selectedTime || undefined,
          signal: controller.signal,
        });
        // Only update if this request wasn't aborted
        if (!controller.signal.aborted) {
          setBoard(data);
          setError(null);
          setLastRefreshed(new Date());
        }
      } catch (err) {
        // Ignore aborted requests
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load board");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [station.crsCode, activeTab, selectedTime],
  );

  // Load on mount and when tab/time changes; abort on cleanup
  useEffect(() => {
    loadBoard();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadBoard]);

  // Auto-poll every 60 seconds when tab is visible
  // Stops polling when tab is hidden to save resources (Visibility API)
  useEffect(() => {
    const POLL_INTERVAL = 60_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return; // Already polling
      intervalId = setInterval(() => {
        loadBoard(true); // silent=true — no loading skeleton
      }, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startPolling();
        setIsLive(true);
        // Refresh immediately when tab becomes visible again
        loadBoard(true);
      } else {
        stopPolling();
        setIsLive(false);
        // Abort in-flight request when tab is hidden
        abortRef.current?.abort();
      }
    };

    // Start polling if tab is visible
    if (document.visibilityState === "visible") {
      startPolling();
      setIsLive(true);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadBoard]);

  // Pull-to-refresh handlers (mobile)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = listRef.current;
    if (!container) return;
    // Only enable pull-to-refresh when scrolled to top
    if (container.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    } else {
      touchStartY.current = 0;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY.current === 0 || isRefreshing) return;
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) {
        // Pulling down
        setPullDistance(Math.min(diff, PULL_THRESHOLD * 1.5));
      }
    },
    [isRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(0);
      loadBoard();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, loadBoard]);

  const displayServices = board?.services || [];
  const serviceCount = displayServices.length;

  // Compute pull indicator opacity
  const pullOpacity = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-slide-up">
      {/* ─── Station header row ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-3 gap-1">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              className="text-sm mr-2 select-none text-text-secondary hover:text-text-primary py-1 px-2 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 rounded gap-1"
              onClick={onBack}
              aria-label="Go back to home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          )}
          <h2 className="text-lg font-bold flex items-center gap-2 text-text-primary">
            {normaliseStationName(board?.stationName || station.name)}
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary">
              {station.crsCode}
            </span>
            {onToggleFavourite && (
              <button
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-lg leading-none transition-all duration-200 cursor-pointer select-none hover:bg-surface-hover active:scale-90 focus-visible:ring-2 focus-visible:ring-blue-500 ${isFavourite ? "text-favourite" : "text-text-muted hover:text-favourite"}`}
                onClick={onToggleFavourite}
                aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
                title={isFavourite ? "Remove from favourites" : "Add to favourites"}
                style={isFavourite ? { animation: "favouritePop 300ms ease-out" } : undefined}
              >
                {isFavourite ? "★" : "☆"}
              </button>
            )}
          </h2>
        </div>
        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto">
          {lastRefreshed && (
            <span className="flex items-center gap-1.5 text-xs select-none text-text-secondary">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${isLive ? "bg-status-on-time animate-pulse-subtle" : "bg-text-muted"}`}
                style={
                  isLive
                    ? { boxShadow: "var(--glow-live)" }
                    : undefined
                }
              />
              <span className="font-mono tabular-nums">{relativeTime}</span>
            </span>
          )}
        </div>
      </div>

      {/* ─── Controls row: tabs + time picker + refresh ─── */}
      <div className="flex flex-row flex-wrap items-center justify-between px-3 sm:px-4 py-1 sm:py-2 gap-2 border-b border-border-default">
        <div className="flex gap-1 shrink-0">
          <button
            className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors select-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${activeTab === "departures" ? "bg-surface-hover text-text-primary font-medium" : "text-text-secondary hover:text-text-primary"}`}
            onClick={() => onTabChange("departures")}
          >
            Departures {activeTab === "departures" && serviceCount > 0 ? serviceCount : ""}
          </button>
          <button
            className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors select-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${activeTab === "arrivals" ? "bg-surface-hover text-text-primary font-medium" : "text-text-secondary hover:text-text-primary"}`}
            onClick={() => onTabChange("arrivals")}
          >
            Arrivals {activeTab === "arrivals" && serviceCount > 0 ? serviceCount : ""}
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onTimeChange ? (
            <TimePicker value={selectedTime || null} onChange={onTimeChange} compact />
          ) : selectedTime ? (
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-alert-delay-bg text-alert-delay-text border border-alert-delay-border">
              {selectedTime}
            </span>
          ) : null}
          <button
            className={`text-lg px-2 select-none transition-transform duration-300 text-text-muted hover:text-text-primary py-1 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${isLoading ? "animate-spin" : ""}`}
            onClick={() => loadBoard()}
            disabled={isLoading}
            aria-label="Refresh board"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ─── NRCC Messages ─── */}
      {board?.nrccMessages && board.nrccMessages.length > 0 && (
        <div className="px-3 sm:px-4 mb-2">
          {board.nrccMessages.map((msg, i) => (
            <div
              key={i}
              className="text-xs px-2 py-1 rounded mb-1 bg-alert-delay-bg text-alert-delay-text border border-alert-delay-border"
            >
              {msg.Value}
            </div>
          ))}
        </div>
      )}

      {/* ─── Platform legend (all screens) ─── */}
      <div className="flex flex-wrap gap-2 sm:gap-4 justify-center text-[10px] py-1.5 text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-platform-confirmed-bg inline-block" /> Confirmed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-platform-altered-bg inline-block" /> Altered
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border border-dashed border-border-emphasis inline-block" /> Expected
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border border-border-default inline-block" /> Scheduled
        </span>
      </div>

      {/* ─── Table header (desktop only) — matches ServiceRow grid columns ─── */}
      <div
        className="
          hidden sm:grid items-center px-3 py-2 text-xs font-medium uppercase tracking-wider
          border-b mb-2 sticky top-0 z-10
          text-text-secondary bg-surface-page border-border-default
          sm:grid-cols-[4rem_4rem_auto_1fr_1rem]
          xl:grid-cols-[4rem_4rem_auto_1fr_16rem_1rem]
        "
      >
        <div className="text-right pr-1">Time</div>
        <div className="text-center">Plat</div>
        <div className="min-w-0">Status</div>
        <div className="min-w-0">Destination</div>
        <div className="hidden xl:block">Calling at</div>
        <div />
      </div>

      {/* ─── Pull-to-refresh indicator ─── */}
      <div
        className="text-center overflow-hidden select-none transition-all duration-200 h-[var(--pull-distance)] opacity-[var(--pull-opacity)]"
        style={
          {
            "--pull-distance": `${pullDistance}px`,
            "--pull-opacity": pullOpacity,
          } as React.CSSProperties
        }
        aria-live="polite"
      >
        {isRefreshing ? (
          <div className="flex items-center justify-center py-2 text-sm text-text-muted">
            <div className="w-4 h-4 border-2 border-border-emphasis border-t-transparent rounded-full animate-spin mr-2" />
            Refreshing…
          </div>
        ) : (
          <div className="flex items-center justify-center py-2 text-sm text-text-muted">
            {pullDistance >= PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </div>
        )}
      </div>

      {/* ─── Service list ─── */}
      <div
        className="px-2 sm:px-3 max-h-[70vh] overflow-y-auto"
        ref={listRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLoading && !board && (
          <div className="text-center py-8 text-text-muted animate-pulse-subtle">
            <div className="flex flex-col gap-3 px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-surface-hover rounded-lg" />
              ))}
            </div>
          </div>
        )}
        {error && <div className="text-center py-4 text-status-cancelled">{error}</div>}
        {!isLoading && !error && displayServices.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="font-medium text-text-secondary">
              No {activeTab === "departures" ? "departures" : "arrivals"} found
            </p>
            <p className="text-sm text-text-muted mt-1">
              Try selecting a different time or check the other tab
            </p>
          </div>
        )}
        <div className="animate-stagger flex flex-col gap-2">
          {displayServices.map((service) => (
            <ServiceRow
              key={service.rid}
              service={service}
              isArrival={activeTab === "arrivals"}
              stationCrs={station.crsCode}
              onSelect={onSelectService}
            />
          ))}
        </div>
      </div>
    </div>
  );
}