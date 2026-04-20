/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Shows scheduled time, platform, destination/origin, operator, status.
 * Clicking navigates to a full ServiceDetail view (no inline expansion).
 *
 * Desktop: table-style layout with next stops preview
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
      return <span className="platform platform-confirmed">{platformLive || platform}</span>;

    case "altered":
      return (
        <span className="platform platform-altered">
          <span className="platform-booked">{platform}</span>
          <span className="platform-arrow">→</span>
          <span className="platform-live">{platformLive}</span>
        </span>
      );

    case "expected":
      return <span className="platform platform-expected">{platform}</span>;

    case "scheduled":
      return <span className="platform platform-scheduled">{platform}</span>;

    default:
      return <span className="platform">{platformLive || platform}</span>;
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
  const destination = isArrival ? service.origin : service.destination;
  const origin = isArrival ? service.destination : service.origin;

  // Determine status display
  const cancelled = service.isCancelled || isCancelled(estimatedTime);
  const onTime = !cancelled && isOnTime(estimatedTime);

  // Get next calling points (up to 3 for preview)
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
        {/* Scheduled time */}
        <div className="service-time">
          <span className="time-scheduled">{formatTime(scheduledTime)}</span>
          {estimatedTime && !onTime && !cancelled && (
            <span className="time-estimated">{formatTime(estimatedTime)}</span>
          )}
          {onTime && <span className="time-on-time">On time</span>}
          {cancelled && <span className="time-cancelled">Cancelled</span>}
        </div>

        {/* Platform */}
        <PlatformBadge
          platform={service.platform}
          platformLive={service.platformLive}
          platformSource={service.platformSource}
        />

        {/* Destination + origin */}
        <div className="service-info">
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

        {/* Desktop: Next stops preview */}
        {nextStops.length > 0 && (
          <div className="service-calling">
            <div className="calling-preview">
              → {nextStops.map(s => s.name || s.crs).join(" → ")}
            </div>
          </div>
        )}

        {/* Operator + ID */}
        <div className="service-operator">
          <span className="hidden lg:inline">{service.tocName || service.toc || ""}</span>
          {service.trainId && <span className="service-id">{service.trainId}</span>}
          {service.length && <span className="service-length hidden lg:inline">· {service.length} coaches</span>}
        </div>

        {/* Status indicator */}
        <div className="service-status">
          {service.hasRealtime && !cancelled && (
            <span className="realtime-badge" title="Real-time data available">●</span>
          )}
          {!service.hasRealtime && (
            <span className="scheduled-badge" title="Scheduled — no real-time data">◎</span>
          )}
        </div>

        {/* Navigation chevron */}
        <div className="service-chevron">
          ›
        </div>
      </div>
    </div>
  );
}