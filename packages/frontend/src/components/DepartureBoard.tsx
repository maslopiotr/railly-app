/**
 * DepartureBoard — Hybrid timetable-first board with real-time overlay
 *
 * Shows all services for a station within a time window (past 10min + next 2hr).
 * Splits into Departures and Arrivals tabs, now server-filtered.
 * Manual refresh only (pull-to-refresh on mobile, button on desktop).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { HybridBoardService, HybridBoardResponse, StationSearchResult } from "@railly-app/shared";
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

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const PULL_THRESHOLD = 60;

  const loadBoard = useCallback(async () => {
    try {
      setBoard(null);
      setIsLoading(true);
      const data = await fetchBoard(station.crsCode, {
        timeWindow: 120,
        pastWindow: 10,
        type: activeTab,
        time: selectedTime || undefined,
      });
      setBoard(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [station.crsCode, activeTab, selectedTime]);

  // Load on mount and when tab changes
  useEffect(() => {
    loadBoard();
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
      {/* Header */}
      <div className="board-header">
        <div className="board-header-left">
          {onBack && (
            <button className="btn-back" onClick={onBack} aria-label="Go back">
              ← Back
            </button>
          )}
          <h2>
            {board?.stationName || station.name}
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
          {onTimeChange ? (
            <TimePicker
              value={selectedTime || null}
              onChange={onTimeChange}
              compact
              className="time-picker-inline"
            />
          ) : selectedTime ? (
            <span className="selected-time-badge">{selectedTime}</span>
          ) : null}
          <button className="btn-refresh" onClick={loadBoard} disabled={isLoading} aria-label="Refresh board">
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

      {/* Tabs */}
      <div className="board-tabs">
          <button
            className={`tab ${activeTab === "departures" ? "active" : ""}`}
            onClick={() => onTabChange("departures")}
          >
            Departures ({activeTab === "departures" ? serviceCount : "—"})
          </button>
          <button
            className={`tab ${activeTab === "arrivals" ? "active" : ""}`}
            onClick={() => onTabChange("arrivals")}
          >
            Arrivals ({activeTab === "arrivals" ? serviceCount : "—"})
          </button>
      </div>

      {/* Platform legend */}
      <div className="board-legend">
        <span className="legend-item">
          <span className="platform-confirmed">5</span> Confirmed
        </span>
        <span className="legend-item">
          <span className="platform-altered">3→7</span> Altered
        </span>
        <span className="legend-item">
          <span className="platform-expected">5</span> Expected
        </span>
        <span className="legend-item">
          <span className="platform-scheduled">5</span> Scheduled
        </span>
      </div>

      {/* Table header (desktop only) - sticky */}
      <div className="board-table-header">
        <div className="col-time">Time</div>
        <div className="col-platform">Plat</div>
        <div className="col-destination">Destination</div>
        <div className="col-operator">Operator</div>
        <div className="col-status">Status</div>
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
          <div className="flex items-center justify-center py-2 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
            Refreshing…
          </div>
        ) : (
          <div className="flex items-center justify-center py-2 text-sm text-slate-400">
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
                <div key={i} className="h-14 bg-slate-700/40 rounded-lg" />
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