/**
 * DepartureBoard — Hybrid timetable-first board with real-time overlay
 *
 * Shows all services for a station within a time window (past 10min + next 2hr).
 * Splits into Departures and Arrivals tabs, now server-filtered.
 * Auto-polls every 30 seconds when visible; manual refresh also available.
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

export function DepartureBoard({ station, isFavourite, onToggleFavourite, onBack, onSelectService, activeTab, onTabChange, selectedTime, onTimeChange }: DepartureBoardProps) {
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

  const loadBoard = useCallback(async (silent = false) => {
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
  }, [station.crsCode, activeTab, selectedTime]);

  // Load on mount and when tab/time changes; abort on cleanup
  useEffect(() => {
    loadBoard();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadBoard]);

  // Auto-poll every 30 seconds when tab is visible
  // Stops polling when tab is hidden to save resources (Visibility API)
  // ~2 requests/min per user, each ~6ms DB time — negligible server load
  useEffect(() => {
    const POLL_INTERVAL = 60_000; // 60 seconds
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

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === 0 || isRefreshing) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) {
      // Pulling down
      setPullDistance(Math.min(diff, PULL_THRESHOLD * 1.5));
    }
  }, [isRefreshing]);

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

  return (
    <div className="departure-board w-full max-w-6xl mx-auto animate-fade-slide-up">
      {/* Station header row */}
      <div className="board-header">
        <div className="board-header-left">
          {onBack && (
            <button className="btn-back" onClick={onBack} aria-label="Go back">
              ← Back
            </button>
          )}
          <h2>
            {normaliseStationName(board?.stationName || station.name)}
            <span className="crs-badge">{station.crsCode}</span>
            {onToggleFavourite && (
              <button
                className={`btn-favourite ${isFavourite ? "is-favourite" : ""}`}
                onClick={onToggleFavourite}
                aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
                title={isFavourite ? "Remove from favourites" : "Add to favourites"}
              >
                {isFavourite ? "★" : "☆"}
              </button>
            )}
          </h2>
        </div>
        <div className="board-header-right">
          {lastRefreshed && (
            <span className="refresh-status">
              <span className={`live-dot ${isLive ? "live" : "paused"}`} />
              <span className="refresh-status-text">{relativeTime}</span>
            </span>
          )}
        </div>
      </div>

      {/* Controls row: tabs + time picker + refresh */}
      <div className="board-controls">
        <div className="board-tabs">
          <button
            className={`tab ${activeTab === "departures" ? "active" : ""}`}
            onClick={() => onTabChange("departures")}
          >
            Departures {activeTab === "departures" ? serviceCount : ""}
          </button>
          <button
            className={`tab ${activeTab === "arrivals" ? "active" : ""}`}
            onClick={() => onTabChange("arrivals")}
          >
            Arrivals {activeTab === "arrivals" ? serviceCount : ""}
          </button>
        </div>
        <div className="board-controls-right">
          {onTimeChange ? (
            <TimePicker
              value={selectedTime || null}
              onChange={onTimeChange}
              compact
            />
          ) : selectedTime ? (
            <span className="selected-time-badge">{selectedTime}</span>
          ) : null}
          <button className={`btn-refresh ${isLoading ? "spinning" : ""}`} onClick={() => loadBoard()} disabled={isLoading} aria-label="Refresh board" title="Refresh">
            ↻
          </button>
        </div>
      </div>

      {/* NRCC Messages */}
      {board?.nrccMessages && board.nrccMessages.length > 0 && (
        <div className="nrcc-messages">
          {board.nrccMessages.map((msg, i) => (
            <div key={i} className="nrcc-message">{msg.Value}</div>
          ))}
        </div>
      )}

      {/* Platform legend (desktop only) */}
      <div className="board-legend hidden">
        <span className="legend-item">
          <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 inline-block" /> Confirmed
        </span>
        <span className="legend-item">
          <span className="w-2 h-2 rounded-full bg-amber-600 dark:bg-amber-400 inline-block" /> Altered
        </span>
        <span className="legend-item">
          <span className="w-2 h-2 rounded-full border border-dashed border-gray-400 dark:border-slate-500 inline-block" /> Expected
        </span>
        <span className="legend-item">
          <span className="w-2 h-2 rounded-full border border-gray-300 dark:border-slate-600 inline-block" /> Scheduled
        </span>
      </div>

      {/* Table header (desktop only) — matches ServiceRow column widths */}
      <div className="board-table-header hidden lg:flex">
        <div className="w-16 shrink-0 text-right pr-1">Time</div>
        <div className="w-14 shrink-0 text-center">Plat</div>
        <div className="flex-1 min-w-0">Destination</div>
        <div className="w-48 shrink-0 hidden xl:block">Calling at</div>
        <div className="w-20 shrink-0 text-right">Status</div>
        <div className="w-4 shrink-0" />
      </div>

      {/* Pull-to-refresh indicator */}
      <div
        className="pull-to-refresh-indicator"
        style={{
          height: `${pullDistance}px`,
          opacity: pullDistance / PULL_THRESHOLD,
          overflow: "hidden",
        }}
      >
        {isRefreshing ? (
          <div className="flex items-center justify-center py-2 text-sm text-gray-400 dark:text-slate-400">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
            Refreshing…
          </div>
        ) : (
          <div className="flex items-center justify-center py-2 text-sm text-gray-400 dark:text-slate-400">
            {pullDistance >= PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </div>
        )}
      </div>

      {/* Service list */}
      <div
        className="board-services"
        ref={listRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLoading && !board && (
          <div className="loading animate-pulse-subtle">
            <div className="flex flex-col gap-3 px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-gray-200 dark:bg-slate-700/40 rounded-lg" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="error-message">{error}</div>
        )}
        {!isLoading && !error && displayServices.length === 0 && (
          <div className="no-services">No services found in this time window</div>
        )}
        <div className="animate-stagger">
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