/**
 * DepartureBoard — NR-style live departures/arrivals board with real-time overlay
 *
 * Features:
 * - Live departures/arrivals for any UK station
 * - "Going to" destination filter
 * - Duration and stops count in service rows
 * - Auto-polling every 60s
 * - Earlier/Later navigation buttons
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { HybridBoardService, HybridBoardResponse, StationSearchResult } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";
import { fetchBoard } from "../api/boards";
import { ServiceRow } from "./ServiceRow";
import { StationSearch } from "./StationSearch";
import { BOARD_GRID_COLS, BOARD_GRID_GAP, BOARD_GRID_PAD } from "./boardGrid";

interface DepartureBoardProps {
  station: StationSearchResult;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onBack?: () => void;
  onSelectService?: (service: HybridBoardService) => void;
  /** Controlled active tab — lifted to App.tsx for persistence across navigation */
  activeTab: "departures" | "arrivals";
  onTabChange: (tab: "departures" | "arrivals") => void;
  /** Destination station for "Going to" filter */
  destinationStation?: StationSearchResult | null;
  /** Callback when destination station changes */
  onDestinationChange?: (dest: StationSearchResult | null) => void;
}

/** Compute journey duration in minutes from calling points */
function computeDurationMinutes(service: HybridBoardService): number | null {
  const cps = service.callingPoints;
  if (!cps || cps.length < 2) return null;

  const firstCp = cps[0];
  const lastCp = cps[cps.length - 1];

  const startTime = firstCp.ptdTimetable || firstCp.ptaTimetable;
  const endTime = lastCp.ptaTimetable || lastCp.ptdTimetable;
  if (!startTime || !endTime) return null;

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null;

  let startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins < startMins) endMins += 1440; // cross-midnight
  return endMins - startMins;
}

/** Count intermediate passenger stops (excl. origin and destination) */
function countStops(service: HybridBoardService): number {
  if (!service.callingPoints || service.callingPoints.length <= 2) return 0;
  // Exclude PP, OPOR, OPIP, OPDT and the first/last stops
  const passengerTypes = new Set(["OR", "IP", "DT"]);
  const filtered = service.callingPoints.filter(
    (cp) => passengerTypes.has(cp.stopType) || cp.ptaTimetable || cp.ptdTimetable
  );
  return Math.max(0, filtered.length - 2); // exclude origin and destination
}

/** Format duration as "1h 23m" or "23m" */
function formatDuration(minutes: number | null): string | null {
  if (minutes === null || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function DepartureBoard({
  station,
  isFavourite,
  onToggleFavourite,
  onBack,
  onSelectService,
  activeTab,
  onTabChange,
  destinationStation,
  onDestinationChange,
}: DepartureBoardProps) {
  const [board, setBoard] = useState<HybridBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [allServices, setAllServices] = useState<HybridBoardService[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Destination filter — derived from destinationStation prop or local fallback dropdown
  const destinationFilter = destinationStation?.crsCode ?? null;

  // Relative time string
  const [relativeTime, setRelativeTime] = useState<string>("");

  // Time window navigation — offset from "now" in minutes (0 = live mode)
  const [timeWindowOffset, setTimeWindowOffset] = useState(0);

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

  const PAGE_SIZE = 15;

  // Compute the HH:MM time string for the current offset, or null for live mode
  const computeRequestTime = useCallback((): string | null => {
    if (timeWindowOffset === 0) return null; // live mode
    const now = new Date();
    const targetMinutes = now.getHours() * 60 + now.getMinutes() + timeWindowOffset;
    const adjustedMinutes = ((targetMinutes % 1440) + 1440) % 1440; // wrap around midnight
    const h = Math.floor(adjustedMinutes / 60);
    const m = adjustedMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }, [timeWindowOffset]);

  const loadBoard = useCallback(
    async (silent = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!silent) {
          setBoard(null);
          setIsLoading(true);
        }
        const requestTime = computeRequestTime();
        const data = await fetchBoard(station.crsCode, {
          limit: PAGE_SIZE,
          type: activeTab,
          destination: destinationFilter || undefined,
          time: requestTime ?? undefined,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setBoard(data);
          setAllServices(data.services);
          setHasMore(data.hasMore);
          setError(null);
          setLastRefreshed(new Date());
        }
      } catch (err: unknown) {
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
    [station.crsCode, activeTab, destinationFilter, computeRequestTime],
  );

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const requestTime = computeRequestTime();
      const data = await fetchBoard(station.crsCode, {
        limit: PAGE_SIZE,
        offset: allServices.length,
        type: activeTab,
        destination: destinationFilter || undefined,
        time: requestTime ?? undefined,
      });
      setAllServices((prev) => [...prev, ...data.services]);
      setHasMore(data.hasMore);
    } catch (err: unknown) {
      console.error("Failed to load more services:", err instanceof Error ? err.message : err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, station.crsCode, activeTab, destinationFilter, computeRequestTime, allServices.length]);

  // Load on mount and when tab/destination changes
  useEffect(() => {
    loadBoard();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadBoard]);

  // Auto-poll every 60 seconds when tab is visible
  useEffect(() => {
    const POLL_INTERVAL = 60_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        loadBoard(true);
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
        loadBoard(true);
      } else {
        stopPolling();
        abortRef.current?.abort();
      }
    };

    if (document.visibilityState === "visible") {
      startPolling();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadBoard]);

  // ── Time navigation helpers (Earlier/Later by 60 minutes) ──
  const handleEarlier = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset((prev) => prev - 60);
  }, []);

  const handleLater = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset((prev) => prev + 60);
  }, []);

  const handleNow = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset(0);
  }, []);

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = listRef.current;
    if (!container) return;
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

  const displayServices = allServices;

  // Compute pull indicator opacity
  const pullOpacity = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-slide-up">
      {/* ─── Station header row ─── */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center px-4 py-3 gap-3">
        {/* Left: Back button */}
        <div>
          {onBack && (
            <button
              className="text-sm select-none text-text-secondary hover:text-text-primary py-1 px-2 min-h-11 flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 rounded gap-1"
              onClick={onBack}
              aria-label="Go back to home"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          )}
        </div>

        {/* Centre: Station name + CRS + favourite */}
        <div className="flex items-center justify-center gap-2 min-w-0">
          <h2 className="text-lg font-bold flex items-center gap-2 text-text-primary truncate">
            {normaliseStationName(board?.stationName || station.name)}
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary">
              {station.crsCode}
            </span>
          </h2>
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
        </div>

        {/* Right: Live status + refresh */}
        <div className="flex items-center gap-2 shrink-0">
          {lastRefreshed && (
            <span className="flex items-center gap-1.5 text-xs select-none text-text-secondary">
              <span
                className="w-2 h-2 rounded-full shrink-0 bg-status-on-time animate-pulse-subtle"
                style={{ boxShadow: "var(--glow-live)" }}
              />
              <span className="font-mono tabular-nums">{relativeTime}</span>
            </span>
          )}
          <button
            className={`text-base px-1.5 select-none transition-transform duration-300 text-text-muted hover:text-text-primary py-1 min-h-9 flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${isLoading ? "animate-spin" : ""}`}
            onClick={() => loadBoard()}
            disabled={isLoading}
            aria-label="Refresh board"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ─── Tab bar (Departures/Arrivals) ─── */}
      <div className="flex border-b border-border-default px-4">
        <button
          className={`px-6 py-3 text-sm font-medium transition-colors select-none border-b-2 -mb-px focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "departures" ? "border-blue-600 text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          onClick={() => onTabChange("departures")}
        >
          Departures
        </button>
        <button
          className={`px-6 py-3 text-sm font-medium transition-colors select-none border-b-2 -mb-px focus-visible:ring-2 focus-visible:ring-blue-500 ${activeTab === "arrivals" ? "border-blue-600 text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}
          onClick={() => onTabChange("arrivals")}
        >
          Arrivals
        </button>
        <div className="flex-1" />
      </div>

      {/* ─── From / Going to row ─── */}
      {onDestinationChange && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b border-border-default bg-surface-card">
          {/* From */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0">From</span>
            <div className="flex items-center gap-1 min-w-0 bg-surface-hover rounded px-2 py-1.5 flex-1 sm:w-[200px]">
              <span className="text-sm font-semibold text-text-primary truncate">
                {normaliseStationName(board?.stationName || station.name)}
              </span>
              <span className="text-[10px] font-mono text-text-muted shrink-0">{station.crsCode}</span>
            </div>
          </div>
          
          {/* To / Going to */}
          <div className="flex items-center gap-2 w-full sm:w-auto flex-1 sm:flex-none">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0">To</span>
            {destinationStation ? (
              <div className="flex items-center gap-1 min-w-0 bg-surface-hover rounded px-2 py-1.5 flex-1 sm:w-[200px]">
                <span className="text-sm font-semibold text-text-primary truncate">
                  {normaliseStationName(destinationStation.name)}
                </span>
                <span className="text-[10px] font-mono text-text-muted shrink-0">
                  {destinationStation.crsCode}
                </span>
                <button
                  onClick={() => onDestinationChange(null)}
                  className="text-text-muted hover:text-status-cancelled text-xs px-1 shrink-0 focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                  aria-label="Clear destination"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex-1 sm:w-[200px] shrink-0">
                <StationSearch
                  onSelect={(s) => onDestinationChange(s)}
                  placeholder="Any station…"
                  size="default"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Earlier / Live / Later navigation bar ─── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default bg-surface-page">
        <button
          onClick={handleEarlier}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-blue-500"
          aria-label="Show earlier trains"
        >
          ← Earlier
        </button>
        <button
          onClick={handleNow}
          disabled={timeWindowOffset === 0}
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 ${
            timeWindowOffset === 0
              ? "border-blue-600 bg-blue-600 text-white cursor-default"
              : "border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          }`}
          aria-label="Return to live departures"
        >
          Live now
        </button>
        <button
          onClick={handleLater}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-blue-500"
          aria-label="Show later trains"
        >
          Later →
        </button>
        <span className="text-xs text-text-muted ml-2">
          {timeWindowOffset === 0
            ? "Live"
            : `${timeWindowOffset > 0 ? "+" : ""}${Math.floor(timeWindowOffset / 60)}h`}
        </span>
        {destinationFilter && onDestinationChange && (
          <button
            onClick={() => onDestinationChange(null)}
            className="ml-auto px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors focus-visible:ring-1 focus-visible:ring-blue-500"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* ─── NRCC Messages ─── */}
      {board?.nrccMessages && board.nrccMessages.length > 0 && (
        <div className="px-4 py-2">
          {board.nrccMessages.map((msg, i) => (
            <div
              key={i}
              className="text-xs px-3 py-1.5 rounded mb-1 bg-alert-delay-bg text-alert-delay-text border border-alert-delay-border"
            >
              {msg.Value}
            </div>
          ))}
        </div>
      )}

      {/* ─── Table header ─── */}
      <div
        className={`
          hidden sm:grid items-center ${BOARD_GRID_GAP} ${BOARD_GRID_PAD}
          text-xs font-medium uppercase tracking-wider
          border-b
          text-text-secondary bg-surface-page border-border-default
          ${BOARD_GRID_COLS}
        `}
      >
        <div className="text-right">Time</div>
        <div className="text-center">Plat</div>
        <div className="min-w-0">Status</div>
        <div className="min-w-0">Destination</div>
        <div className="hidden xl:block">Calling at</div>
        <div />
      </div>

      {/* ─── Pull-to-refresh indicator ─── */}
      <div
        className="text-center overflow-hidden select-none transition-all duration-200 h-(--pull-distance) opacity-(--pull-opacity)"
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
              {destinationFilter
                ? "Try changing the destination filter"
                : "Try the other tab or check back later"}
            </p>
            {destinationFilter && onDestinationChange && (
              <button
                onClick={() => onDestinationChange(null)}
                className="mt-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
              >
                Clear destination filter
              </button>
            )}
          </div>
        )}
        <div className="animate-stagger flex flex-col gap-2">
          {displayServices.map((service) => {
            const duration = computeDurationMinutes(service);
            const stops = countStops(service);
            const durationStr = formatDuration(duration);

            return (
              <ServiceRow
                key={service.rid}
                service={service}
                isArrival={activeTab === "arrivals"}
                stationCrs={station.crsCode}
                onSelect={onSelectService}
                subtitle={`${stops === 0 ? "Direct" : `${stops} stop${stops !== 1 ? "s" : ""}`}${durationStr ? ` · ${durationStr}` : ""}`}
              />
            );
          })}
        </div>

        {/* ─── Load more ─── */}
        {hasMore && !isLoading && (
          <div className="flex justify-center py-3">
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-border-emphasis border-t-transparent rounded-full animate-spin" />
                  Loading…
                </span>
              ) : (
                "Load more services"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}