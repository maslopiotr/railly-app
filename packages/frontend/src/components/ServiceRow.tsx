/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Shows scheduled time, platform (with source distinction), destination/origin,
 * operator, real-time status, and expandable calling points.
 *
 * Desktop: table-style layout with calling points column
 * Mobile: stacked card with origin + next stops
 */

import { useState } from "react";
import type { HybridBoardService, HybridCallingPoint, PlatformSource } from "@railly-app/shared";
import { CallingPoints } from "./CallingPoints";
import { LoadingIndicator } from "./LoadingIndicator";

interface ServiceRowProps {
  service: HybridBoardService;
  /** Whether this row is shown on the arrivals tab */
  isArrival?: boolean;
  /** CRS code of the current station (for calling point highlighting) */
  stationCrs?: string;
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

/** Parse time string to minutes since midnight for delay calculation */
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const formatted = formatTime(time);
  if (formatted === "--:--") return null;
  const [h, m] = formatted.split(":").map(Number);
  return h * 60 + m;
}

/** Calculate delay in minutes between scheduled and estimated */
function calculateDelay(scheduled: string | null, estimated: string | null): number | null {
  if (!scheduled || !estimated) return null;
  if (estimated === "On time") return 0;
  
  const schedMins = timeToMinutes(scheduled);
  const estMins = timeToMinutes(estimated);
  
  if (schedMins === null || estMins === null) return null;
  return estMins - schedMins;
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
      // Live matches booked — show in blue/bold
      return <span className="platform platform-confirmed">{platformLive || platform}</span>;

    case "altered":
      // Live differs from booked — show "booked→live" in amber
      return (
        <span className="platform platform-altered">
          <span className="platform-booked">{platform}</span>
          <span className="platform-arrow">→</span>
          <span className="platform-live">{platformLive}</span>
        </span>
      );

    case "expected":
      // LDBWS doesn't have platform yet, show booked as "expected" in grey
      return <span className="platform platform-expected">{platform}</span>;

    case "scheduled":
      // No LDBWS data at all, show booked as "scheduled" in muted
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

  // Find the current station in the calling pattern
  let currentIndex = -1;
  if (currentCrs) {
    currentIndex = callingPoints.findIndex(cp => cp.crs === currentCrs);
  }

  // If not found, assume we're at the origin (index 0)
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  // Get the next N stops (skip the current station)
  return callingPoints
    .slice(currentIndex + 1)
    .filter(cp => cp.stopType !== "PP") // Skip passing points
    .slice(0, count);
}

/** Get all calling points after the current station */
function getAllCallingPoints(
  callingPoints: HybridCallingPoint[],
  currentCrs: string | null
): HybridCallingPoint[] {
  if (!callingPoints || callingPoints.length === 0) return [];

  let currentIndex = -1;
  if (currentCrs) {
    currentIndex = callingPoints.findIndex(cp => cp.crs === currentCrs);
  }
  if (currentIndex === -1) currentIndex = 0;

  return callingPoints.slice(currentIndex + 1);
}

export function ServiceRow({ service, isArrival, stationCrs }: ServiceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [callingExpanded, setCallingExpanded] = useState(false);

  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const destination = isArrival ? service.origin : service.destination;
  const origin = isArrival ? service.destination : service.origin;

  // Determine status display
  const cancelled = service.isCancelled || isCancelled(estimatedTime);
  const onTime = !cancelled && isOnTime(estimatedTime);
  const delayed = !cancelled && !onTime && estimatedTime && estimatedTime !== scheduledTime;

  // Get next calling points (up to 3 for preview)
  const nextStops = getNextCallingPoints(service.callingPoints || [], stationCrs || null, 3);
  const allStops = getAllCallingPoints(service.callingPoints || [], stationCrs || null);

  return (
    <div className={`service-row ${cancelled ? "cancelled" : ""} ${expanded ? "expanded" : ""}`}>
      {/* Main row */}
      <div className="service-main" onClick={() => setExpanded(!expanded)}>
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
          {/* Show origin/destination subtext based on direction */}
          {/* For arrivals: destination=service.origin, origin=service.destination */}
          {/* Arrivals subtext: "To {origin}" = where it goes after here */}
          {/* Departures subtext: "From {origin}" = where it came from */}
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

        {/* Desktop: Calling points column */}
        {nextStops.length > 0 && (
          <div className="service-calling">
            {callingExpanded ? (
              <div className="calling-expanded" onClick={e => e.stopPropagation()}>
                {allStops.map((stop, i) => {
                  const scheduledTime = stop.ptd || stop.pta;
                  const estimatedTime = stop.etd || stop.eta;
                  const delay = calculateDelay(scheduledTime, estimatedTime);
                  const isLate = delay !== null && delay > 0;
                  const isOnTime = estimatedTime === "On time" || delay === 0;
                  const hasActual = stop.atd || stop.ata;
                  
                  return (
                    <span key={i} className="calling-stop">
                      <span className={`calling-stop-time ${
                        hasActual ? "arrived" : isLate ? "late" : isOnTime ? "on-time" : ""
                      }`}>
                        {formatTime(estimatedTime && !isOnTime ? estimatedTime : scheduledTime)}
                        {isLate && !hasActual && <span className="delay-badge">(+{delay})</span>}
                      </span>
                      <span className="calling-stop-name">{stop.name || stop.crs}</span>
                      {i < allStops.length - 1 && <span className="calling-stop-arrow">→</span>}
                    </span>
                  );
                })}
                <button
                  className="calling-expand-btn"
                  onClick={e => { e.stopPropagation(); setCallingExpanded(false); }}
                >
                  [− Hide]
                </button>
              </div>
            ) : (
              <div className="calling-preview">
                → {nextStops.map(s => s.name || s.crs).join(" → ")}
                {allStops.length > 3 && (
                  <button
                    className="calling-expand-btn"
                    onClick={e => { e.stopPropagation(); setCallingExpanded(true); }}
                  >
                    [+ {allStops.length - 3} more]
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Operator + ID */}
        <div className="service-operator">
          <span className="hidden lg:inline">{service.tocName || service.toc || ""}</span>
          {service.trainId && <span className="service-id">{service.trainId}</span>}
          {service.length && <span className="service-length hidden lg:inline">· {service.length} coaches</span>}
        </div>

        {/* Status / Formation indicator */}
        <div className="service-status">
          {service.formation && service.formation.coaches && (
            <LoadingIndicator formation={service.formation} compact />
          )}
          {service.hasRealtime && !cancelled && (
            <span className="realtime-badge" title="Real-time data available">●</span>
          )}
          {!service.hasRealtime && (
            <span className="scheduled-badge" title="Scheduled — no real-time data">◎</span>
          )}
        </div>

        {/* Expand chevron */}
        <div className={`service-chevron ${expanded ? "open" : ""}`}>
          ▾
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="service-details">
          {/* Cancel reason */}
          {cancelled && service.cancelReason && (
            <div className="alert alert-cancel">
              <strong>Cancelled:</strong> {service.cancelReason}
            </div>
          )}

          {/* Delay reason */}
          {delayed && service.delayReason && (
            <div className="alert alert-delay">
              <strong>Delayed:</strong> {service.delayReason}
            </div>
          )}

          {/* Ad-hoc alerts */}
          {service.adhocAlerts?.map((alert, i) => (
            <div key={i} className="alert alert-adhoc">{alert}</div>
          ))}

          {/* Platform alteration note */}
          {service.platformSource === "altered" && (
            <div className="alert alert-platform">
              Platform altered from {service.platform} to {service.platformLive}
            </div>
          )}

          {/* Formation (coach loading) */}
          {service.formation && service.formation.coaches && (
            <div className="service-formation">
              <h4 className="text-xs font-medium text-slate-400 mb-1">Formation</h4>
              <LoadingIndicator formation={service.formation} />
            </div>
          )}

          {/* Calling points (full) */}
          {service.callingPoints && service.callingPoints.length > 0 && (
            <CallingPoints
              points={service.callingPoints}
              currentCrs={stationCrs || null}
            />
          )}

          {/* Service ID info */}
          <div className="service-ids">
            <span>RID: {service.rid}</span>
            {service.uid && <span>UID: {service.uid}</span>}
            {service.serviceId && <span>LDBWS: {service.serviceId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}