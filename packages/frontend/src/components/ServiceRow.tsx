/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Shows scheduled time, platform (with source distinction), destination/origin,
 * operator, real-time status, and expandable calling points.
 */

import { useState } from "react";
import type { HybridBoardService, PlatformSource } from "@railly-app/shared";
import { CallingPoints } from "./CallingPoints";
import { LoadingIndicator } from "./LoadingIndicator";

interface ServiceRowProps {
  service: HybridBoardService;
  /** Whether this row is shown on the arrivals tab */
  isArrival?: boolean;
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

export function ServiceRow({ service, isArrival }: ServiceRowProps) {
  const [expanded, setExpanded] = useState(false);

  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const destination = isArrival ? service.origin : service.destination;

  // Determine status display
  const cancelled = service.isCancelled || isCancelled(estimatedTime);
  const onTime = !cancelled && isOnTime(estimatedTime);
  const delayed = !cancelled && !onTime && estimatedTime && estimatedTime !== scheduledTime;

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

        {/* Destination + operator */}
        <div className="service-info">
          <div className="service-destination">
            {destination?.name || destination?.crs || "Unknown"}
          </div>
          <div className="service-operator">
            {service.tocName || service.toc || ""}
            {service.trainId && <span className="service-id">{service.trainId}</span>}
            {service.length && <span className="service-length">{service.length} coaches</span>}
          </div>
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
              <h4>Formation</h4>
              <LoadingIndicator formation={service.formation} />
            </div>
          )}

          {/* Calling points */}
          {service.callingPoints && service.callingPoints.length > 0 && (
            <CallingPoints
              points={service.callingPoints}
              currentCrs={null}
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