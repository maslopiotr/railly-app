/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Single responsive layout using Tailwind utility classes — no show/hide toggles.
 * Status logic uses service.trainStatus from the backend (computed correctly).
 * Supports both light and dark mode.
 */

import type { HybridBoardService, HybridCallingPoint } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime } from "@railly-app/shared";
import { PlatformBadge } from "./PlatformBadge";

interface ServiceRowProps {
  service: HybridBoardService;
  isArrival?: boolean;
  stationCrs?: string;
  onSelect?: (service: HybridBoardService) => void;
}

/** Format time for display, falling back to "--:--" when null */
function displayTime(time: string | null | undefined): string {
  return formatDisplayTime(time) ?? "--:--";
}

function getNextCallingPoints(
  callingPoints: HybridCallingPoint[],
  currentCrs: string | null,
  count: number
): HybridCallingPoint[] {
  if (!callingPoints || callingPoints.length === 0) return [];
  let currentIndex = -1;
  if (currentCrs) {
    currentIndex = callingPoints.findIndex(cp => cp.crs === currentCrs);
  }
  if (currentIndex === -1) currentIndex = 0;
  return callingPoints
    .slice(currentIndex + 1)
    .filter(cp => cp.stopType !== "PP")
    .slice(0, count);
}

/** Status badge for tablet/desktop */
function StatusBadge({ service }: { service: HybridBoardService }) {
  const ts = service.trainStatus;
  if (ts === "cancelled" || service.isCancelled) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-600 dark:text-red-300 border border-red-500/30">Cancelled</span>;
  }
  if (ts === "at_platform") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-700 dark:text-green-300 border border-emerald-500/30 dark:border-green-500/30">At plat.</span>;
  }
  if (ts === "arrived") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-700 dark:text-green-300 border border-emerald-500/30 dark:border-green-500/30">Arrived</span>;
  }
  if (ts === "departed") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-600 dark:text-slate-300 border border-gray-500/30 dark:border-slate-500/30">Departed</span>;
  }
  if (ts === "approaching") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">Approaching</span>;
  }
  if (ts === "delayed") {
    const mins = service.delayMinutes;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-600 dark:text-red-300 border border-red-500/30">+{mins ?? 0} min</span>;
  }
  if (ts === "on_time") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-green-400 border border-emerald-500/20 dark:border-green-500/20">On time</span>;
  }
  // scheduled or unknown
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-500/10 text-gray-500 dark:text-slate-400 border border-gray-500/20 dark:border-slate-500/20">Scheduled</span>;
}

export function ServiceRow({ service, isArrival, stationCrs, onSelect }: ServiceRowProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const destination = isArrival ? service.origin : service.destination;

  const ts = service.trainStatus;
  const cancelled = ts === "cancelled" || service.isCancelled;
  const isOnTime = ts === "on_time";
  const isDelayed = ts === "delayed";
  const isDeparted = ts === "departed";
  const isArrived = ts === "arrived";
  const isAtPlatform = ts === "at_platform";

  const nextStops = getNextCallingPoints(service.callingPoints || [], stationCrs || null, 4);
  const operatorText = service.tocName || service.toc || "";
  const mainName = normaliseStationName(destination?.name) || destination?.crs || "Unknown";

  return (
    <div
      className={`service-row press-feedback ${cancelled ? "cancelled" : ""} cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-lg`}
      onClick={() => onSelect?.(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(service); }}
      aria-label={`${displayTime(scheduledTime)} to ${mainName}${cancelled ? " Cancelled" : ""}`}
    >
      {/* ─── Mobile layout (<640px): 2-line compact ─── */}
      <div className="flex flex-col gap-0.5 px-3 py-2 sm:hidden min-h-[44px]">
        {/* Line 1: Time | Platform | Destination | Chevron */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono font-semibold min-w-[3.25rem] ${
            cancelled ? "text-red-600 line-through dark:text-red-400" : isDelayed ? "text-gray-400 line-through dark:text-slate-400" : "text-gray-900 dark:text-white"
          }`}>
            {displayTime(scheduledTime)}
          </span>

          <PlatformBadge
            platformTimetable={service.platformTimetable}
            platformLive={service.platformLive}
            platformSource={service.platformSource}
          />

          <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-white truncate">
            {mainName}
          </span>

          <span className="text-gray-400 dark:text-slate-400 text-lg">›</span>
        </div>

        {/* Line 2: Status (single source of truth) + metadata */}
        <div className="flex items-center gap-1.5 pl-[3.25rem] flex-wrap">
          {cancelled ? (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Cancelled</span>
          ) : isArrived || isDeparted ? (
            <span className="text-xs font-mono text-emerald-600 dark:text-green-400">
              {isArrived ? "Arrived" : "Departed"} {displayTime(actualTime)}
            </span>
          ) : isAtPlatform ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-green-400">At platform</span>
          ) : isOnTime ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-green-400">On time</span>
          ) : isDelayed ? (
            <>
              <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                Exp {displayTime(estimatedTime)}
              </span>
              {service.delayMinutes !== null && service.delayMinutes > 0 && (
                <span className="text-[10px] font-mono text-red-600 dark:text-red-400">+{service.delayMinutes} min</span>
              )}
            </>
          ) : service.hasRealtime && estimatedTime ? (
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400">{displayTime(estimatedTime)}</span>
          ) : (
            <span className="text-xs text-gray-400 dark:text-slate-500">Scheduled</span>
          )}

          {/* Metadata: operator, train ID, coach count — compact on mobile */}
          {operatorText && (
            <span className="text-[10px] text-gray-400 dark:text-slate-400 truncate">
              {operatorText}
            </span>
          )}
          {service.trainId && (
            <span className="service-id text-[10px]">{service.trainId}</span>
          )}
          {service.length && (
            <span className="text-[10px] text-gray-400 dark:text-slate-500">· {service.length} coaches</span>
          )}
        </div>
      </div>

      {/* ─── Tablet + Desktop (≥640px): inline row ─── */}
      <div className="hidden sm:flex items-center service-main">
        {/* Time */}
        <div className="service-time w-16 shrink-0">
          <span className={`text-sm font-mono font-semibold ${
            cancelled ? "text-red-600 line-through dark:text-red-400" : isDelayed ? "text-gray-400 line-through dark:text-slate-400" : "text-gray-900 dark:text-white"
          }`}>
            {displayTime(scheduledTime)}
          </span>
          {(isArrived || isDeparted) && actualTime && (
            <span className="text-xs font-mono text-emerald-600 dark:text-green-400 block">{displayTime(actualTime)}</span>
          )}
          {isDelayed && estimatedTime && (
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 block">Exp {displayTime(estimatedTime)}</span>
          )}
          {isOnTime && (
            <span className="text-[10px] text-emerald-600 dark:text-green-400 block">On time</span>
          )}
          {cancelled && (
            <span className="text-[10px] text-red-600 dark:text-red-400 block">Cancelled</span>
          )}
        </div>

        {/* Platform */}
        <div className="w-14 shrink-0 flex justify-center">
          <PlatformBadge
            platformTimetable={service.platformTimetable}
            platformLive={service.platformLive}
            platformSource={service.platformSource}
          />
        </div>

        {/* Destination + operator */}
        <div className="flex-1 min-w-0">
          <div className="service-destination">{mainName}</div>
          <div className="text-xs text-gray-400 dark:text-slate-500 truncate">
            {operatorText}
            {service.trainId && <span className="service-id ml-1">{service.trainId}</span>}
            {service.length && <span className="service-length ml-1">· {service.length} coaches</span>}
          </div>
        </div>

        {/* Calling points (desktop xl only) */}
        {nextStops.length > 0 && (
          <div className="w-48 shrink-0 hidden xl:block">
            <div className="text-xs text-gray-400 dark:text-slate-500 truncate">
              → {nextStops.map(s => normaliseStationName(s.name) || s.crs).join(" → ")}
            </div>
          </div>
        )}

        {/* Status badge */}
        <div className="shrink-0 lg:w-20 lg:flex lg:justify-end">
          <StatusBadge service={service} />
        </div>

        {/* Chevron */}
        <div className="service-chevron">›</div>
      </div>
    </div>
  );
}