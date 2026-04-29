/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Single responsive layout using Tailwind utility classes — no show/hide toggles.
 * Status logic uses service.trainStatus from the backend (computed correctly).
 */

import type { HybridBoardService, HybridCallingPoint, PlatformSource } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";

interface ServiceRowProps {
  service: HybridBoardService;
  isArrival?: boolean;
  stationCrs?: string;
  onSelect?: (service: HybridBoardService) => void;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "--:--";
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  return cleaned;
}

function PlatformBadge({ platformTimetable, platformLive, platformSource }: {
  platformTimetable: string | null;
  platformLive: string | null;
  platformSource: PlatformSource;
}) {
  if (!platformTimetable && !platformLive) {
    return <span className="platform platform-none">—</span>;
  }
  switch (platformSource) {
    case "confirmed":
      return <span className="platform platform-confirmed">{platformLive || platformTimetable}</span>;
    case "altered":
      return (
        <span className="platform platform-altered">
          <span className="platform-booked">{platformTimetable}</span>
          <span className="platform-arrow">→</span>
          <span className="platform-live">{platformLive}</span>
        </span>
      );
    case "suppressed":
      return (
        <span className="platform platform-suppressed">
          {platformLive}
          <span className="suppressed-indicator">✱</span>
        </span>
      );
    case "expected":
      return <span className="platform platform-expected">—</span>;
    case "scheduled":
      return <span className="platform platform-scheduled">{platformTimetable}</span>;
    default:
      return <span className="platform">{platformLive || platformTimetable}</span>;
  }
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
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">Cancelled</span>;
  }
  if (ts === "at_platform") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">At plat.</span>;
  }
  if (ts === "arrived") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-500/30">Arrived</span>;
  }
  if (ts === "departed") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-300 border border-slate-500/30">Departed</span>;
  }
  if (ts === "approaching") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">Approaching</span>;
  }
  if (ts === "delayed") {
    const mins = service.delayMinutes;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30">+{mins ?? 0} min</span>;
  }
  if (ts === "on_time") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">On time</span>;
  }
  // scheduled or unknown
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">Scheduled</span>;
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
      className={`service-row press-feedback ${cancelled ? "cancelled" : ""} cursor-pointer`}
      onClick={() => onSelect?.(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(service); }}
      aria-label={`${formatTime(scheduledTime)} to ${mainName}${cancelled ? " Cancelled" : ""}`}
    >
      {/* ─── Mobile layout (<640px): 2-line compact ─── */}
      <div className="flex flex-col gap-0.5 px-3 py-2 sm:hidden">
        {/* Line 1: Time | Platform | Destination | Chevron */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono font-semibold min-w-[3.25rem] ${
            cancelled ? "text-red-400 line-through" : isDelayed ? "text-slate-400 line-through" : "text-white"
          }`}>
            {formatTime(scheduledTime)}
          </span>

          <PlatformBadge
            platformTimetable={service.platformTimetable}
            platformLive={service.platformLive}
            platformSource={service.platformSource}
          />

          <span className="flex-1 min-w-0 text-sm font-medium text-white truncate">
            {mainName}
          </span>

          <span className="text-slate-400 text-lg">›</span>
        </div>

        {/* Line 2: Status (single source of truth) */}
        <div className="flex items-center gap-1.5 pl-[3.25rem]">
          {cancelled ? (
            <span className="text-xs font-medium text-red-400">Cancelled</span>
          ) : isArrived || isDeparted ? (
            <span className="text-xs font-mono text-green-400">
              {isArrived ? "Arrived" : "Departed"} {formatTime(actualTime)}
            </span>
          ) : isAtPlatform ? (
            <span className="text-xs font-medium text-green-400">At platform</span>
          ) : isOnTime ? (
            <span className="text-xs font-medium text-green-400">On time</span>
          ) : isDelayed ? (
            <>
              <span className="text-xs font-mono font-semibold text-amber-400">
                Exp {formatTime(estimatedTime)}
              </span>
              {service.delayMinutes !== null && service.delayMinutes > 0 && (
                <span className="text-[10px] font-mono text-red-400">+{service.delayMinutes} min</span>
              )}
            </>
          ) : service.hasRealtime && estimatedTime ? (
            <span className="text-xs font-mono text-amber-400">{formatTime(estimatedTime)}</span>
          ) : (
            <span className="text-xs text-slate-500">Scheduled</span>
          )}

          {operatorText && (
            <div className="text-xs text-slate-500 truncate">
            <span className="text-[10px] text-slate-300 ml-1">{operatorText}</span>
            {service.trainId && <span className="service-id ml-1">{service.trainId}</span>}
            {service.length && <span className="service-length ml-1">· {service.length} coaches</span>}
          </div>

          )}
        </div>
      </div>

      {/* ─── Tablet + Desktop (≥640px): inline row ─── */}
      <div className="hidden sm:flex items-center service-main">
        {/* Time */}
        <div className="service-time w-16 shrink-0">
          <span className={`text-sm font-mono font-semibold ${
            cancelled ? "text-red-400 line-through" : isDelayed ? "text-slate-400 line-through" : "text-white"
          }`}>
            {formatTime(scheduledTime)}
          </span>
          {(isArrived || isDeparted) && actualTime && (
            <span className="text-xs font-mono text-green-400 block">{formatTime(actualTime)}</span>
          )}
          {isDelayed && estimatedTime && (
            <span className="text-xs font-mono text-amber-400 block">Exp {formatTime(estimatedTime)}</span>
          )}
          {isOnTime && (
            <span className="text-[10px] text-green-400 block">On time</span>
          )}
          {cancelled && (
            <span className="text-[10px] text-red-400 block">Cancelled</span>
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
          <div className="text-xs text-slate-500 truncate">
            {operatorText}
            {service.trainId && <span className="service-id ml-1">{service.trainId}</span>}
            {service.length && <span className="service-length ml-1">· {service.length} coaches</span>}
          </div>
        </div>

        {/* Calling points (desktop xl only) */}
        {nextStops.length > 0 && (
          <div className="w-48 shrink-0 hidden xl:block">
            <div className="text-xs text-slate-500 truncate">
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