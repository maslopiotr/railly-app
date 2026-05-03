/**
 * ServiceDetail — Full-screen detail view for a single train service
 *
 * Page structure:
 * 1. Header — back arrow, refresh button, platform badge
 * 2. Route hero — origin → destination with status-specific text
 * 3. Alerts — cancellation, delay, platform alteration, current location, ad-hoc
 * 4. Time comparison table — scheduled vs real-time for this station
 * 5. Formation — coach loading (if available)
 * 6. Timeline — CallingPoints component
 * 7. Footer — RID and UID
 *
 * Uses semantic design tokens only — no raw Tailwind colour classes.
 */

import type { HybridBoardService } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime, computeDelay } from "@railly-app/shared";
import { CallingPoints } from "../components/service-detail/CallingPoints";
import { LoadingIndicator } from "../components/service-detail/LoadingIndicator";
import { PlatformBadge } from "../components/shared/PlatformBadge";
import { computeDurationMinutes, formatDuration } from "../utils/service";

interface ServiceDetailProps {
  service: HybridBoardService;
  isArrival: boolean;
  stationCrs: string;
  /** Destination CRS for computing journey duration */
  destinationCrs?: string | null;
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/** Format time for display, falling back to "--:--" when null */
function displayTime(time: string | null | undefined): string {
  return formatDisplayTime(time) ?? "--:--";
}

/** Get delay severity colour class for real-time column */
function getDelayColorClass(delay: number | null): string {
  if (delay === null) return "text-text-secondary";
  if (delay >= 15) return "text-status-cancelled";
  if (delay >= 2) return "text-status-delayed";
  return "text-status-on-time";
}

/** Get delay severity text class for delay column */
function getDelayTextClass(delay: number | null): string {
  if (delay === null) return "";
  if (delay >= 15) return "text-status-cancelled font-medium";
  if (delay >= 2) return "text-status-delayed font-medium";
  return "text-status-on-time";
}

/**
 * Delay badge pill for inline use.
 * Coloured pill: amber for 2–14 min delay, red for ≥15 min.
 */
function DelayPill({ delay }: { delay: number }) {
  const abs = Math.abs(delay);
  const pillClass =
    abs >= 15
      ? "bg-status-cancelled-bg text-status-cancelled border-status-cancelled-border"
      : "bg-status-delayed-bg text-status-delayed border-status-delayed-border";

  return (
    <span className={`text-[10px] font-mono font-medium border px-1.5 py-0 rounded ${pillClass}`}>
      +{delay} min
    </span>
  );
}

export function ServiceDetail({
  service,
  isArrival,
  stationCrs,
  destinationCrs,
  onBack,
  onRefresh,
  isRefreshing,
}: ServiceDetailProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;

  const cancelled =
    service.isCancelled ||
    estimatedTime === "Cancelled" ||
    estimatedTime === "cancelled";

  const onTime = !cancelled && estimatedTime === "On time";
  const delay = computeDelay(scheduledTime, estimatedTime, actualTime);
  const isDelayed = !cancelled && delay !== null && delay >= 2;
  const isSeverelyDelayed = !cancelled && delay !== null && delay >= 15;

  // Duration: only show when destination filter is set (spec: "No destination → No duration")
  const durationMinutes = destinationCrs
    ? computeDurationMinutes(service, stationCrs, isArrival, destinationCrs)
    : null;
  const durationText = formatDuration(durationMinutes);

  // ── Route hero: journey-aware display ──
  // When the user is at an intermediate station, show their journey perspective
  // (e.g. "Milton Keynes Central → London Euston" with "On service from Birmingham New Street")
  const stationCp = stationCrs
    ? service.callingPoints?.find(cp => cp.crs === stationCrs)
    : null;
  const originCrs = service.origin?.crs;
  const destCrs = service.destination?.crs;
  const isIntermediateStation = !!stationCrs && !!stationCp
    && !!originCrs && stationCrs !== originCrs && stationCrs !== destCrs;

  const displayOriginName = isIntermediateStation
    ? (normaliseStationName(stationCp!.name) || stationCrs)
    : (normaliseStationName(service.origin?.name) || service.origin?.crs || "Unknown");

  const displayDestName = normaliseStationName(service.destination?.name) || service.destination?.crs || "Unknown";

  const serviceFromName = isIntermediateStation
    ? (normaliseStationName(service.origin?.name) || service.origin?.crs)
    : null;

  // ── Route hero status rendering ──
  const renderRouteHeroStatus = () => {
    if (cancelled) {
      return (
        <span className="text-sm font-semibold text-status-cancelled">Cancelled</span>
      );
    }

    const status = service.trainStatus;

    switch (status) {
      case "on_time": {
        // On time, not yet departed — no actual time expected
        if (onTime) {
          return (
            <span className="text-sm font-semibold text-status-on-time">On time</span>
          );
        }
        // Has estimated time different from scheduled (delayed, but status still on_time edge case)
        if (estimatedTime && estimatedTime !== "On time" && scheduledTime && estimatedTime !== scheduledTime) {
          const timeColor = isSeverelyDelayed ? "text-status-cancelled" : "text-status-delayed";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm font-mono font-semibold ${timeColor}`}>
                {displayTime(estimatedTime)}
              </span>
              {isDelayed && <DelayPill delay={delay!} />}
            </div>
          );
        }
        return (
          <span className="text-sm font-semibold text-status-on-time">On time</span>
        );
      }

      case "delayed": {
        if (actualTime) {
          // Delayed but has actual time (departed/arrived late)
          const timeColor = isSeverelyDelayed ? "text-status-cancelled" : "text-status-delayed";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm font-mono font-semibold ${timeColor}`}>
                {displayTime(actualTime)}
              </span>
              {isDelayed && <DelayPill delay={delay!} />}
            </div>
          );
        }

        if (estimatedTime && estimatedTime !== "On time") {
          const timeColor = isSeverelyDelayed ? "text-status-cancelled" : "text-status-delayed";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm font-mono font-semibold ${timeColor}`}>
                {displayTime(estimatedTime)}
              </span>
              {isDelayed && <DelayPill delay={delay!} />}
            </div>
          );
        }

        return (
          <span className="text-sm font-semibold text-status-delayed">Delayed</span>
        );
      }

      case "approaching": {
        if (isDelayed && estimatedTime && estimatedTime !== "On time") {
          const timeColor = isSeverelyDelayed ? "text-status-cancelled" : "text-status-delayed";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-status-approaching">Approaching</span>
              <span className={`text-sm font-mono ${timeColor}`}>
                Exp {displayTime(estimatedTime)}
              </span>
              <DelayPill delay={delay!} />
            </div>
          );
        }
        return (
          <span className="text-sm font-semibold text-status-approaching">Approaching</span>
        );
      }

      case "at_platform": {
        return (
          <span className="text-sm font-semibold text-status-at-platform">At platform</span>
        );
      }

      case "arrived": {
        if (actualTime) {
          const timeColor = delay !== null && delay >= 2
            ? (delay >= 15 ? "text-status-cancelled" : "text-status-delayed")
            : "text-status-arrived";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-status-arrived">Arrived</span>
              <span className={`text-sm font-mono ${timeColor}`}>{displayTime(actualTime)}</span>
              {isDelayed && <DelayPill delay={delay!} />}
            </div>
          );
        }
        return (
          <span className="text-sm font-semibold text-status-arrived">Arrived</span>
        );
      }

      case "departed": {
        if (actualTime) {
          const timeColor = delay !== null && delay >= 2
            ? (delay >= 15 ? "text-status-cancelled" : "text-status-delayed")
            : "text-status-arrived";
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-status-arrived">Departed</span>
              <span className={`text-sm font-mono ${timeColor}`}>{displayTime(actualTime)}</span>
              {isDelayed && <DelayPill delay={delay!} />}
            </div>
          );
        }
        return (
          <span className="text-sm font-semibold text-status-arrived">Departed</span>
        );
      }

      case "scheduled": {
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-mono text-text-secondary">
              {displayTime(scheduledTime)}
            </span>
          </div>
        );
      }

      default:
        return null;
    }
  };

  // ── Current location dot colour ──
  const locationDotClass = service.currentLocation
    ? service.currentLocation.status === "at_platform"
      ? "bg-status-at-platform"
      : service.currentLocation.status === "approaching"
        ? "bg-status-approaching"
        : service.currentLocation.status === "arrived"
          ? "bg-status-arrived"
          : "bg-text-muted"
    : "";

  const locationText = service.currentLocation
    ? service.currentLocation.status === "at_platform"
      ? `At platform — ${normaliseStationName(service.currentLocation.name) || service.currentLocation.crs || service.currentLocation.tpl}`
      : service.currentLocation.status === "approaching"
        ? `Approaching ${normaliseStationName(service.currentLocation.name) || service.currentLocation.crs || service.currentLocation.tpl}`
        : service.currentLocation.status === "arrived"
          ? `Arrived at ${normaliseStationName(service.currentLocation.name) || service.currentLocation.crs || service.currentLocation.tpl}`
          : service.currentLocation.status === "future"
            ? `En route to ${normaliseStationName(service.currentLocation.name) || service.currentLocation.crs || service.currentLocation.tpl}`
            : `Departed ${normaliseStationName(service.currentLocation.name) || service.currentLocation.crs || service.currentLocation.tpl}`
    : "";

  return (
    <div className="rounded-xl border overflow-hidden bg-surface-card border-border-default">
      {/* ─── 1. Header ─── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
        <button
          onClick={onBack}
          className="text-text-muted hover:text-text-primary transition-colors p-1 -ml-1 focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          aria-label="Back to board"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="text-text-muted hover:text-text-primary p-1.5 rounded-lg hover:bg-surface-hover disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 transition-transform duration-100 active:scale-[0.97]"
              aria-label="Refresh service"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}

          <div className="shrink-0">
            <PlatformBadge
              platformTimetable={service.platformTimetable}
              platformLive={service.platformLive}
              platformSource={service.platformSource}
              size="large"
            />
          </div>
        </div>
      </div>

      {/* ─── 2. Route hero ─── */}
      <div className="px-4 py-3 border-b border-border-default">
        <div className="flex items-center gap-2 text-base">
          <span className="font-semibold text-text-primary truncate">
            {displayOriginName}
          </span>
          <span className="text-text-muted shrink-0">→</span>
          <span className="font-semibold text-text-primary truncate">
            {displayDestName}
          </span>
        </div>
        {serviceFromName && (
          <div className="text-xs text-text-muted mt-0.5">
            On service from {serviceFromName}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-1 text-text-secondary text-sm">
          {renderRouteHeroStatus()}
          {service.tocName && (
            <>
              <span className="text-text-muted mx-0.5">·</span>
              <span>{service.tocName}</span>
            </>
          )}
          {!cancelled && durationText && (
            <>
              <span className="text-text-muted mx-0.5">·</span>
              <span>{durationText}</span>
            </>
          )}
        </div>
      </div>

      {/* ─── 3. Alerts ─── */}
      {cancelled && service.cancelReason && (
        <div className="mx-4 mt-3 p-3 bg-alert-cancel-bg border border-alert-cancel-border rounded-lg text-alert-cancel-text text-sm">
          <strong>Cancelled:</strong> {service.cancelReason}
        </div>
      )}
      {/* Delay alert: always show when delayed, even without a reason string */}
      {isDelayed && (
        <div className="mx-4 mt-3 p-3 bg-alert-delay-bg border border-alert-delay-border rounded-lg text-alert-delay-text text-sm">
          <strong>Delayed {delay} min</strong>
          {service.delayReason && (
            <span>: {service.delayReason}</span>
          )}
        </div>
      )}
      {service.platformSource === "altered" &&
        service.platformLive &&
        service.platformTimetable !== service.platformLive && (
          <div className="mx-4 mt-3 p-3 bg-alert-delay-bg border border-alert-delay-border rounded-lg text-alert-delay-text text-sm">
            Platform altered from {service.platformTimetable} to {service.platformLive}
          </div>
        )}
      {service.currentLocation && (
        <div className="mx-4 mt-3 p-3 bg-alert-info-bg border border-alert-info-border rounded-lg text-alert-info-text text-sm flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${locationDotClass}`} />
          <span>{locationText}</span>
        </div>
      )}
      {service.adhocAlerts?.map((alert, i) => (
        <div
          key={i}
          className="mx-4 mt-3 p-3 bg-alert-info-bg border border-alert-info-border rounded-lg text-alert-info-text text-sm"
        >
          {alert}
        </div>
      ))}

      {/* ─── 4. Time comparison table ─── */}
      <div className="mx-4 mt-4">
        <table
          className="w-full text-sm border-collapse"
          aria-label="Scheduled vs real-time times for this station"
        >
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border-default">
              <th className="py-1 font-medium">Event</th>
              <th className="py-1 font-medium">Scheduled</th>
              <th className="py-1 font-medium">Real-time</th>
              <th className="py-1 font-medium">Delay</th>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {service.sta && (
              <tr className="border-b border-border-default/50">
                <td className="py-1.5">Arrival</td>
                <td className="py-1.5 font-mono">{displayTime(service.sta)}</td>
                <td className="py-1.5 font-mono">
                  {service.actualArrival ? (
                    <span className="text-status-arrived">
                      {displayTime(service.actualArrival)}
                    </span>
                  ) : service.eta ? (
                    <span className={getDelayColorClass(computeDelay(service.sta, service.eta, null))}>
                      {displayTime(service.eta)}
                    </span>
                  ) : (
                    <span className="text-text-muted">--:--</span>
                  )}
                </td>
                <td className="py-1.5">
                  {(() => {
                    const arrDelay = computeDelay(
                      service.sta,
                      service.eta,
                      service.actualArrival,
                    );
                    if (arrDelay === null)
                      return <span className="text-text-muted">--</span>;
                    return (
                      <span className={getDelayTextClass(arrDelay)}>
                        {arrDelay > 0 ? "+" : ""}{arrDelay} min
                      </span>
                    );
                  })()}
                </td>
              </tr>
            )}
            {service.std && (
              <tr>
                <td className="py-1.5">Departure</td>
                <td className="py-1.5 font-mono">{displayTime(service.std)}</td>
                <td className="py-1.5 font-mono">
                  {service.actualDeparture ? (
                    <span className="text-status-arrived">
                      {displayTime(service.actualDeparture)}
                    </span>
                  ) : service.etd ? (
                    <span className={getDelayColorClass(computeDelay(service.std, service.etd, null))}>
                      {displayTime(service.etd)}
                    </span>
                  ) : (
                    <span className="text-text-muted">--:--</span>
                  )}
                </td>
                <td className="py-1.5">
                  {(() => {
                    const depDelay = computeDelay(
                      service.std,
                      service.etd,
                      service.actualDeparture,
                    );
                    if (depDelay === null)
                      return <span className="text-text-muted">--</span>;
                    return (
                      <span className={getDelayTextClass(depDelay)}>
                        {depDelay > 0 ? "+" : ""}{depDelay} min
                      </span>
                    );
                  })()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── 5. Formation (above timeline) ─── */}
      {service.formation && (
        <div className="mx-4 mt-3">
          <LoadingIndicator formation={service.formation} />
          {service.length && !service.formation.coaches && (
            <div className="text-xs text-text-secondary mt-1">
              {service.length} coaches
            </div>
          )}
        </div>
      )}
      {!service.formation && service.length && (
        <div className="mx-4 mt-3 text-xs text-text-secondary">
          {service.length} coaches
        </div>
      )}

      {/* ─── 6. Timeline (calling points) ─── */}
      <div className="mx-4 mt-4 pb-4">
        {service.callingPoints && service.callingPoints.length > 0 ? (
          <CallingPoints
            points={service.callingPoints}
            currentCrs={stationCrs}
          />
        ) : (
          <p className="text-text-muted text-sm">No calling point data available</p>
        )}
      </div>

      {/* ─── 7. Footer ─── */}
      <div className="px-4 py-3 border-t border-border-default text-[10px] text-text-muted font-mono">
        <span>RID: {service.rid}</span>
        {service.uid && (
          <>
            {" "}&middot; <span>UID: {service.uid}</span>
          </>
        )}
        {service.trainId && (
          <>
            {" "}&middot; <span>{service.trainId}</span>
          </>
        )}
      </div>
    </div>
  );
}