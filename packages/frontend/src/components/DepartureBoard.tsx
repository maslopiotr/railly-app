/**
 * DepartureBoard — Hybrid timetable-first board with LDBWS real-time overlay
 *
 * Shows all services for a station within a time window (past 10min + next 2hr).
 * Splits into Departures and Arrivals tabs based on std/sta fields.
 * Auto-refreshes every 30 seconds.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { HybridBoardService, HybridBoardResponse, StationSearchResult } from "@railly-app/shared";
import { fetchBoard } from "../api/boards";
import { ServiceRow } from "./ServiceRow";

interface DepartureBoardProps {
  station: StationSearchResult;
  onBack?: () => void;
}

type TabType = "departures" | "arrivals";

/** Classify a service as departure, arrival, or both (through service) */
function classifyService(service: HybridBoardService): {
  isDeparture: boolean;
  isArrival: boolean;
} {
  // Has scheduled departure time → it's a departure
  const isDeparture = service.std !== null;
  // Has scheduled arrival time → it's an arrival
  // Through services (both sta + std) appear on BOTH tabs —
  // matching real UK station boards where arrivals includes through services
  const isArrival = service.sta !== null;

  return { isDeparture, isArrival };
}

export function DepartureBoard({ station, onBack }: DepartureBoardProps) {
  const [activeTab, setActiveTab] = useState<TabType>("departures");
  const [board, setBoard] = useState<HybridBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadBoard = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchBoard(station.crsCode, {
        timeWindow: 120,
        pastWindow: 10,
      });
      setBoard(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setIsLoading(false);
    }
  }, [station.crsCode]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    loadBoard();
    const interval = setInterval(loadBoard, 30000);
    return () => clearInterval(interval);
  }, [loadBoard]);

  // Split services into departures and arrivals
  const { departures, arrivals } = useMemo(() => {
    const allServices = board?.services || [];
    const deps: HybridBoardService[] = [];
    const arrs: HybridBoardService[] = [];

    for (const service of allServices) {
      const { isDeparture, isArrival } = classifyService(service);
      if (isDeparture) deps.push(service);
      if (isArrival) arrs.push(service);
    }

    return { departures: deps, arrivals: arrs };
  }, [board]);

  const displayServices = activeTab === "departures" ? departures : arrivals;

  // Scroll to "now" indicator
  const listRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);

  // Scroll to current time on first load
  useEffect(() => {
    if (nowRef.current && listRef.current) {
      nowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [board]);

  return (
    <div className="departure-board">
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
          </h2>
        </div>
        <div className="board-header-right">
          {lastUpdated && (
            <span className="last-updated">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="btn-refresh" onClick={loadBoard} disabled={isLoading}>
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
          onClick={() => setActiveTab("departures")}
        >
          Departures ({departures.length})
        </button>
        <button
          className={`tab ${activeTab === "arrivals" ? "active" : ""}`}
          onClick={() => setActiveTab("arrivals")}
        >
          Arrivals ({arrivals.length})
        </button>
      </div>

      {/* Table header (desktop only) - sticky */}
      <div className="board-table-header">
        <div className="col-time">Time</div>
        <div className="col-platform">Plat</div>
        <div className="col-destination">Destination</div>
        <div className="col-calling">Calling at</div>
        <div className="col-operator">Operator</div>
        <div className="col-status">Status</div>
      </div>

      {/* Service list */}
      <div className="board-services" ref={listRef}>
        {isLoading && !board && (
          <div className="loading">Loading services...</div>
        )}
        {error && (
          <div className="error-message">{error}</div>
        )}
        {!isLoading && !error && displayServices.length === 0 && (
          <div className="no-services">No services found in this time window</div>
        )}
        {displayServices.map((service) => (
          <ServiceRow key={service.rid} service={service} isArrival={activeTab === "arrivals"} stationCrs={station.crsCode} />
        ))}
      </div>

      {/* Legend */}
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
    </div>
  );
}