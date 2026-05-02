/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Single responsive grid layout — no show/hide toggles, no dual DOM trees.
 * Colours use semantic design tokens only.
 * Status logic uses service.trainStatus from the backend as single source of truth.
 *
 * Grid order: Time | Platform | Status | Destination | [Calling at] | Chevron
 * Grid config is shared with DepartureBoard header via boardGrid.ts.
 */

import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime } from "@railly-app/shared";
import { PlatformBadge } from "../shared/PlatformBadge";
import { BOARD_GRID_COLS, BOARD_GRID_GAP, BOARD_GRID_PAD } from "./boardGrid";

interface ServiceRowProps {
  service: HybridBoardService;
  isArrival?: boolean;
  stationCrs?: string;
  onSelect?: (service: HybridBoardService) => void;
  /** Optional subtitle line (e.g. "3 stops · 1h 23m") */
  subtitle?: string;
}

/** Format time for display, falling back to "--:--" when null */
function displayTime(time: string | null | undefined): string {
  return formatDisplayTime(time) ?? "--:--";
}

function getNextCallingPoints(
  callingPoints: HybridCallingPoint[],
  currentCrs: string | null,
  count: number,
): HybridCallingPoint[] {
  if (!callingPoints || callingPoints.length === 0) return [];
  let currentIndex = -1;
  if (currentCrs) {
    currentIndex = callingPoints.findIndex((cp) => cp.crs === currentCrs);
  }
  if (currentIndex === -1) currentIndex = 0;
  return callingPoints
    .slice(currentIndex + 1)
    .filter((cp) => !NON_PASSENGER_STOP_TYPES.has(cp.stopType))
    .slice(0, count);
}

/** Stop types excluded from passenger-facing calling point displays */
const NON_PASSENGER_STOP_TYPES = new Set([
  "PP",   // Passing point
  "OPOR", // Operational origin
  "OPIP", // Operational intermediate
  "OPDT", // Operational destination
]);

/** Loading tier for busy indicator */
type LoadingTier = "low" | "moderate" | "busy";

function getLoadingTier(percentage: number): LoadingTier {
  return percentage <= 30 ? "low" : percentage <= 70 ? "moderate" : "busy";
}

/** Small busy indicator pill for the board row */
function BusyIndicator({ percentage }: { percentage: number }) {
  const tier = getLoadingTier(percentage);
  const dotClass = tier === "low"
    ? "bg-loading-low-bar"
    : tier === "moderate"
      ? "bg-loading-moderate-bar"
      : "bg-loading-busy-bar";
  const textClass = tier === "low"
    ? "text-loading-low-bar"
    : tier === "moderate"
      ? "text-loading-moderate-bar"
      : "text-loading-busy-bar";

  const label = tier === "low" ? "Quiet" : tier === "moderate" ? "Moderate" : "Busy";

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

/** Get loading percentage for the board station from calling points */
function getBoardStationLoading(
  callingPoints: HybridCallingPoint[],
  stationCrs: string | null | undefined,
): number | null {
  if (!stationCrs || !callingPoints || callingPoints.length === 0) return null;
  const cp = callingPoints.find(
    (p) => p.crs === stationCrs && !NON_PASSENGER_STOP_TYPES.has(p.stopType),
  );
  return cp?.loadingPercentage ?? null;
}

/** Status badge using semantic tokens, driven by service.trainStatus */
function StatusBadge({ service }: { service: HybridBoardService }) {
  const ts = service.trainStatus;
  const delayMins = service.delayMinutes;

  switch (ts) {
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-cancelled-bg text-status-cancelled border border-status-cancelled-border">
          Cancelled
        </span>
      );
    case "at_platform":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-at-platform-bg text-status-at-platform border border-status-at-platform-border">
          At platform
        </span>
      );
    case "arrived":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-arrived-bg text-status-arrived border border-status-arrived-border">
          Arrived
        </span>
      );
    case "departed":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-departed-bg text-status-departed border border-status-departed-border">
          Departed
        </span>
      );
    case "approaching":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-approaching-bg text-status-approaching border border-status-approaching-border">
          Approaching
        </span>
      );
    case "delayed": {
      const mins = delayMins;
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-delayed-bg text-status-delayed border border-status-delayed-border">
          +{mins ?? 0} min
        </span>
      );
    }
    case "on_time":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-on-time-bg text-status-on-time border border-status-on-time-border">
          On time
        </span>
      );
    case "scheduled":
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-status-scheduled-bg text-status-scheduled border border-status-scheduled-border">
          Scheduled
        </span>
      );
  }
}

/** Small delay pill shown next to departed/arrived status when delay ≥ 2 min */
function DelayPill({ minutes }: { minutes: number }) {
  const severity =
    minutes >= 15
      ? "bg-status-cancelled-bg text-status-cancelled border-status-cancelled-border"
      : "bg-status-delayed-bg text-status-delayed border-status-delayed-border";

  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-mono font-medium border ${severity}`}>
      +{minutes} min
    </span>
  );
}

export function ServiceRow({ service, isArrival, stationCrs, onSelect, subtitle }: ServiceRowProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const destination = isArrival ? service.origin : service.destination;

  const ts = service.trainStatus;
  const cancelled = ts === "cancelled";
  const isOnTime = ts === "on_time";
  const isDelayed = ts === "delayed";
  const isDeparted = ts === "departed";
  const isArrived = ts === "arrived";
  const isAtPlatform = ts === "at_platform";

  // Show delay pill for departed/arrived services that were delayed
  const showDelayPill = (isDeparted || isArrived) && service.delayMinutes !== null && service.delayMinutes >= 2;

  const nextStops = getNextCallingPoints(service.callingPoints || [], stationCrs || null, 4);
  const operatorText = service.tocName || service.toc || "";
  const mainName = normaliseStationName(destination?.name) || destination?.crs || "Unknown";

  // Loading percentage at the board station (for busy indicator)
  const boardLoadingPct = getBoardStationLoading(service.callingPoints || [], stationCrs);

  // Time column text classes
  const timeClass = cancelled
    ? "text-status-cancelled line-through"
    : isDelayed
      ? "text-text-muted line-through"
      : "text-text-primary";

  // Actual time colour: severity-based like DelayPill/DelayBadge
  // Green for on-time (≤1 min early/late), amber for 2-14 min, red for ≥15 min
  const delayAbs = service.delayMinutes !== null ? Math.abs(service.delayMinutes) : 0;
  const actualTimeClass = (isDeparted || isArrived) && delayAbs >= 15
    ? "text-status-cancelled"
    : (isDeparted || isArrived) && delayAbs >= 2
      ? "text-status-delayed"
      : "text-status-arrived";

  return (
    <div
      className={`${cancelled ? "opacity-60" : ""} cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-[--radius-card] transition-transform duration-100 active:scale-[0.97]`}
      onClick={() => onSelect?.(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect?.(service);
      }}
      aria-label={`${displayTime(scheduledTime)} to ${mainName}${cancelled ? " Cancelled" : ""}`}
    >
      {/* Single grid: responsive column definitions change at breakpoints.
          Order: Time | Plat | Status | Destination | [Calling at] | Chevron */}
      <div
        className={`
          grid items-center ${BOARD_GRID_GAP} ${BOARD_GRID_PAD}
          ${BOARD_GRID_COLS}
          min-h-[44px]
          border rounded-[--radius-card]
          bg-surface-card border-border-default hover:bg-surface-hover
        `}
      >
        {/* Column 1: Time */}
        <div className="flex flex-col items-start justify-center">
          <span className={`text-sm font-mono font-semibold leading-tight ${timeClass}`}>
            {displayTime(scheduledTime)}
          </span>
          {(isArrived || isDeparted) && actualTime ? (
            <span className={`text-[11px] font-mono leading-tight ${actualTimeClass}`}>
              {displayTime(actualTime)}
            </span>
          ) : isDelayed && estimatedTime ? (
            <span className="text-[11px] font-mono text-status-delayed leading-tight">
              Exp {displayTime(estimatedTime)}
            </span>
          ) : isOnTime ? (
            <span className="text-[10px] text-status-on-time leading-tight">On time</span>
          ) : cancelled ? (
            <span className="text-[10px] text-status-cancelled leading-tight">Cancelled</span>
          ) : null}
        </div>

        {/* Column 2: Platform */}
        <div className="flex justify-center">
          <PlatformBadge
            platformTimetable={service.platformTimetable}
            platformLive={service.platformLive}
            platformSource={service.platformSource}
          />
        </div>

        {/* Column 3: Status badge (desktop) — between platform and destination */}
        <div className="hidden sm:flex items-center shrink-0 gap-1">
          <StatusBadge service={service} />
          {showDelayPill && <DelayPill minutes={service.delayMinutes!} />}
          {boardLoadingPct !== null && <BusyIndicator percentage={boardLoadingPct} />}
        </div>

        {/* Column 4: Destination + metadata */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{mainName}</div>
          <div className="text-xs text-text-secondary truncate">
            {subtitle && (
              <span className="hidden sm:inline">{subtitle}</span>
            )}
            {!subtitle && <span className="hidden sm:inline">{operatorText}</span>}
            {service.trainId && (
              <span className="hidden sm:inline font-mono text-[11px] bg-surface-hover px-1 rounded text-text-secondary ml-1">
                {service.trainId}
              </span>
            )}
            {service.length && (
              <span className="hidden sm:inline text-text-secondary ml-1">
                · {service.length} coaches
              </span>
            )}
          </div>
        </div>

        {/* Column 5 (xl only): Calling points preview */}
        {nextStops.length > 0 && (
          <div className="hidden xl:block text-xs text-text-secondary truncate">
            → {nextStops.map((s) => normaliseStationName(s.name) || s.crs).join(" → ")}
          </div>
        )}

        {/* Column 6: Chevron */}
        <span className="text-text-muted text-lg text-right">›</span>

        {/* Mobile-only: status + metadata row — col-span-full below the grid.
            Does NOT duplicate time — time is in column 1 above. */}
        <div className="sm:hidden col-span-full flex items-center gap-1.5 flex-wrap pl-[1rem] border-t border-border-default pt-1 mt-0.5">
          {cancelled ? (
            <span className="text-xs font-medium text-status-cancelled">Cancelled</span>
          ) : isArrived || isDeparted ? (
            <>
              <span className="text-xs font-medium text-status-arrived">
                {isArrived ? "Arrived" : "Departed"}
              </span>
              {showDelayPill && <DelayPill minutes={service.delayMinutes!} />}
            </>
          ) : isAtPlatform ? (
            <span className="text-xs font-medium text-status-at-platform">At platform</span>
          ) : isOnTime ? (
            <span className="text-xs font-medium text-status-on-time">On time</span>
          ) : isDelayed ? (
            <>
              <span className="text-xs font-medium text-status-delayed">
                Delayed
              </span>
              {service.delayMinutes !== null && service.delayMinutes > 0 && (
                <span className="text-[10px] font-mono text-status-cancelled">
                  +{service.delayMinutes} min
                </span>
              )}
            </>
          ) : service.hasRealtime ? (
            <span className="text-xs text-text-muted">Scheduled</span>
          ) : (
            <span className="text-xs text-text-muted">Scheduled</span>
          )}

          {operatorText && (
            <span className="text-[10px] text-text-muted truncate">{operatorText}</span>
          )}
          {service.trainId && (
            <span className="text-[10px] font-mono bg-surface-hover px-1 rounded text-text-secondary">
              {service.trainId}
            </span>
          )}
          {service.length && (
            <span className="text-[10px] text-text-secondary">
              · {service.length} coaches
            </span>
          )}
          {boardLoadingPct !== null && <BusyIndicator percentage={boardLoadingPct} />}
        </div>
      </div>
    </div>
  );
}