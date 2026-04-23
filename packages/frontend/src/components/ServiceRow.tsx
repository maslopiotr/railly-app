/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Shows scheduled time, platform, destination/origin, operator, status.
 * Clicking navigates to a full ServiceDetail view (no inline expansion).
 *
 * Desktop: table-style layout
 * Mobile: stacked card with origin + next stops
 */

import type { HybridBoardService, HybridCallingPoint, PlatformSource } from "@railly-app/shared";

interface ServiceRowProps {
  service: HybridBoardService;
  /** Whether this row is shown on the arrivals tab */
  isArrival?: boolean;
  /** CRS code of the current station (for calling point highlighting) */
  stationCrs?: string;
  /** Callback when user clicks to see full details */
  onSelect?: (service: HybridBoardService) => void;
}

/** Format a rail time string (e.g. "0930" → "09:30", "On time" → "On time") */
function formatTime(time: string | null | undefined): string {
  if (!time) return "--:--";
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  return cleaned;
}

/** Check if an estimated time represents "On time" */
function isOnTime(et: string | null | undefined): boolean {
  return et === "On time";
}

/** Check if an estimated time represents a cancellation */
function isCancelled(et: string | null | undefined): boolean {
  return et === "Cancelled" || et === "cancelled";
}

/** Render platform badge with source-based styling */
function PlatformBadge({ platform, platformLive, platformSource }: {
  platform: string | null;
  platformLive: string | null;
  platformSource: PlatformSource;
}) {
  if (!platform && !platformLive) {
    return <span className="platform platform-none">—</span>;
  }

  switch (platformSource) {
    case "confirmed":
      return <span className="platform platform-confirmed">{platformLive}</span>;

    case "altered":
      return (
        <span className="platform platform-altered">
          <span className="platform-booked">{platform}</span>
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
      return <span className="platform platform-scheduled">{platform}</span>;

    default:
      return <span className="platform">{platformLive || platform}</span>;
  }
}

/** Status badge with visual color coding */
function StatusBadge({ status, delayMinutes }: { status: string; delayMinutes: number | null }) {
  const base = "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium";

  switch (status) {
    case "at_platform":
      return (
        <span className={`${base} bg-green-500/20 text-green-300 border border-green-500/30`}>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          At platform
        </span>
      );
    case "approaching":
      return (
        <span className={`${base} bg-yellow-500/20 text-yellow-300 border border-yellow-500/30`}>
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          Approaching
        </span>
      );
    case "departed":
      return (
        <span className={`${base} bg-slate-500/20 text-slate-300 border border-slate-500/30`}>
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          Departed
        </span>
      );
    case "delayed":
      return (
        <span className={`${base} bg-red-500/20 text-red-300 border border-red-500/30`}>
          <span className="w-2 h-2 rounded-full bg-red-400" />
          {delayMinutes !== null ? `+${delayMinutes} min` : "Delayed"}
        </span>
      );
    case "cancelled":
      return (
        <span className={`${base} bg-red-500/20 text-red-300 border border-red-500/30`}>
          Cancelled
        </span>
      );
    case "on_time":
      return (
        <span className={`${base} bg-green-500/10 text-green-400 border border-green-500/20`}>
          On time
        </span>
      );
    default:
      return (
        <span className={`${base} bg-slate-500/10 text-slate-400 border border-slate-500/20`}>
          Scheduled
        </span>
      );
  }
}

/** Get the next N calling points after the current station */
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

export function ServiceRow({ service, isArrival, stationCrs, onSelect }: ServiceRowProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const destination = isArrival ? service.origin : service.destination;
  const origin = isArrival ? service.destination : service.origin;

  const cancelled = service.isCancelled || isCancelled(estimatedTime);
  const onTime = !cancelled && isOnTime(estimatedTime);

  // Get next calling points (up to 3 for mobile preview)
  const nextStops = getNextCallingPoints(service.callingPoints || [], stationCrs || null, 3);

  return (
    <div
      className={`service-row press-feedback ${cancelled ? "cancelled" : ""} cursor-pointer hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors`}
      onClick={() => onSelect?.(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(service); }}
      aria-label={`${formatTime(scheduledTime)} to ${destination?.name || "Unknown"}`}
    >
      {/* Main row */}
      <div className="service-main">
        {/* Time column: scheduled + estimated + actual + delay */}
        <div className="service-time w-24 shrink-0 flex flex-col gap-0.5">
          <span className="time-scheduled text-sm font-mono font-semibold text-white">
            {formatTime(scheduledTime)}
          </span>

          {actualTime && (
            <span className="text-xs font-mono text-green-400">
              {formatTime(actualTime)}
            </span>
          )}

          {!actualTime && estimatedTime && !onTime && !cancelled && (
            <span className="text-xs font-mono text-amber-400">
              {formatTime(estimatedTime)}
            </span>
          )}

          {service.delayMinutes !== null && service.delayMinutes > 0 && !cancelled && (
            <span className="text-[10px] font-medium text-red-400">
              +{service.delayMinutes} min
            </span>
          )}

          {onTime && <span className="text-[10px] font-medium text-green-400">On time</span>}
          {cancelled && <span className="text-[10px] font-medium text-red-400">Cancelled</span>}
        </div>

        {/* Platform */}
        <div className="w-20 shrink-0 flex justify-center">
          <PlatformBadge
            platform={service.platform}
            platformLive={service.platformLive}
            platformSource={service.platformSource}
          />
        </div>

        {/* Destination + origin */}
        <div className="service-info flex-1 min-w-0">
          <div className="service-destination">
            {destination?.name || destination?.crs || "Unknown"}
          </div>
          <div className="service-origin lg:hidden">
            {isArrival
              ? `To ${origin?.name || origin?.crs || "Unknown"}`
              : `From ${origin?.name || origin?.crs || "Unknown"}`
            }
          </div>
          <div className="service-origin hidden lg:block">
            {isArrival
              ? `To ${origin?.name || origin?.crs || "Unknown"}`
              : `From ${origin?.name || origin?.crs || "Unknown"}`
            }
          </div>
          {/* Mobile: show next stops inline */}
          {nextStops.length > 0 && (
            <div className="lg:hidden text-xs text-slate-500 truncate mt-0.5">
              → {nextStops.map(s => s.name || s.crs).join(" → ")}
            </div>
          )}
        </div>

        {/* Operator + ID */}
        <div className="service-operator w-40 shrink-0 hidden lg:block">
          <span>{service.tocName || service.toc || ""}</span>
          {service.trainId && <span className="service-id ml-2">{service.trainId}</span>}
          {service.length && <span className="service-length ml-2">· {service.length} coaches</span>}
        </div>

        {/* Status indicator — new visual badges */}
        <div className="service-status w-16 shrink-0 flex justify-center">
          <StatusBadge status={service.trainStatus} delayMinutes={service.delayMinutes} />
        </div>

        {/* Navigation chevron */}
        <div className="service-chevron">
          ›
        </div>
      </div>
    </div>
  );
}