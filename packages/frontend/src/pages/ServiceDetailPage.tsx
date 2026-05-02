/**
 * ServiceDetail — Full-screen detail view for a single train service
 *
 * Shows calling pattern with time-based dots, alerts, formation, and service IDs.
 * Navigated to from ServiceRow click — no inline expansion.
 * Uses semantic design tokens only — no raw Tailwind colour classes.
 */

import type { HybridBoardService } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime, computeDelay } from "@railly-app/shared";
import { CallingPoints } from "../components/service-detail/CallingPoints";
import { LoadingIndicator } from "../components/service-detail/LoadingIndicator";
import { PlatformBadge } from "../components/shared/PlatformBadge";

interface ServiceDetailProps {
  service: HybridBoardService;
  isArrival: boolean;
  stationCrs: string;
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/** Format time for display, falling back to "--:--" when null */
function displayTime(time: string | null | undefined): string {
  return formatDisplayTime(time) ?? "--:--";
}

export function ServiceDetail({
  service,
  isArrival,
  stationCrs,
  onBack,
  onRefresh,
  isRefreshing,
}: ServiceDetailProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const displayStation = isArrival ? service.origin : service.destination;

  const cancelled =
    service.isCancelled ||
    estimatedTime === "Cancelled" ||
    estimatedTime === "cancelled";
  const onTime = !cancelled && estimatedTime === "On time";
  const delay = computeDelay(scheduledTime, estimatedTime, actualTime);
  const isDelayed = !cancelled && delay !== null && delay > 1;

  return (
    <div className="rounded-xl border overflow-hidden bg-surface-card border-border-default">
      {/* ─── Header ─── */}
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-mono font-bold text-text-primary">
              {displayTime(scheduledTime)}
            </span>
            {actualTime && (
              <span className="text-xl font-mono font-bold text-status-arrived">
                {displayTime(actualTime)}
              </span>
            )}
            {!actualTime && estimatedTime && !onTime && !cancelled && (
              <span className="text-xl font-mono font-bold text-status-delayed">
                {displayTime(estimatedTime)}
              </span>
            )}
            {onTime && (
              <span className="text-sm font-medium text-status-on-time">On time</span>
            )}
            {cancelled && (
              <span className="text-sm font-medium text-status-cancelled">Cancelled</span>
            )}
          </div>
          <div className="text-sm text-text-secondary truncate">
            {normaliseStationName(displayStation?.name) || displayStation?.crs || "Unknown"}
          </div>
        </div>

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

      {/* ─── Alerts ─── */}
      {cancelled && service.cancelReason && (
        <div className="mx-4 mt-3 p-3 bg-alert-cancel-bg border border-alert-cancel-border rounded-lg text-alert-cancel-text text-sm">
          <strong>Cancelled:</strong> {service.cancelReason}
        </div>
      )}
      {isDelayed && service.delayReason && (
        <div className="mx-4 mt-3 p-3 bg-alert-delay-bg border border-alert-delay-border rounded-lg text-alert-delay-text text-sm">
          <strong>Delayed {delay} min:</strong> {service.delayReason}
        </div>
      )}
      {service.platformSource === "altered" &&
        service.platformLive &&
        service.platformTimetable !== service.platformLive && (
          <div className="mx-4 mt-3 p-3 bg-alert-delay-bg border border-alert-delay-border rounded-lg text-alert-delay-text text-sm">
            Platform altered from {service.platformTimetable} to {service.platformLive}
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

      {/* ─── Current location indicator ─── */}
      {service.currentLocation && (
        <div className="mx-4 mt-3 p-3 bg-alert-info-bg border border-alert-info-border rounded-lg text-alert-info-text text-sm flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              service.currentLocation.status === "at_platform"
                ? "bg-status-at-platform"
                : service.currentLocation.status === "approaching"
                  ? "bg-status-approaching"
                  : service.currentLocation.status === "arrived"
                    ? "bg-status-arrived"
                    : "bg-text-muted"
            }`}
          />
          <span>
            {service.currentLocation.status === "at_platform"
              ? "At platform"
              : service.currentLocation.status === "approaching"
                ? "Approaching"
                : service.currentLocation.status === "arrived"
                  ? "Arrived"
                  : service.currentLocation.status === "future"
                    ? "En route to"
                    : "Departed"}{" "}
            {normaliseStationName(service.currentLocation.name) ||
              service.currentLocation.crs ||
              service.currentLocation.tpl}
          </span>
        </div>
      )}

      {/* ─── Time comparison table ─── */}
      <div className="mx-4 mt-4">
        <table
          className="w-full text-sm border-collapse"
          aria-label="Scheduled vs real-time times for this service"
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
                    <span
                      className={
                        service.eta === "On time"
                          ? "text-status-on-time"
                          : "text-status-delayed"
                      }
                    >
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
                      <span
                        className={
                          arrDelay > 0 ? "text-status-cancelled" : "text-status-on-time"
                        }
                      >
                        {arrDelay > 0 ? "+" : ""}
                        {arrDelay} min
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
                    <span
                      className={
                        service.etd === "On time"
                          ? "text-status-on-time"
                          : "text-status-delayed"
                      }
                    >
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
                      <span
                        className={
                          depDelay > 0 ? "text-status-cancelled" : "text-status-on-time"
                        }
                      >
                        {depDelay > 0 ? "+" : ""}
                        {depDelay} min
                      </span>
                    );
                  })()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Route info ─── */}
      <div className="mx-4 mt-4 flex items-center gap-2 text-xs text-text-secondary">
        <span>
          {normaliseStationName(service.origin?.name) || service.origin?.crs || "Unknown"}
        </span>
        <span className="text-text-muted">→</span>
        <span>
          {normaliseStationName(service.destination?.name) ||
            service.destination?.crs ||
            "Unknown"}
        </span>
        {service.tocName && (
          <>
            <span className="text-text-muted">·</span>
            <span>{service.tocName}</span>
          </>
        )}
        {service.trainId && (
          <>
            <span className="text-text-muted">·</span>
            <span className="font-mono text-text-muted">{service.trainId}</span>
          </>
        )}
      </div>

      {/* ─── Formation ─── */}
      {service.formation && service.formation.coaches && (
        <div className="mx-4 mt-3">
          <h4 className="text-xs font-medium text-text-secondary mb-1">Formation</h4>
          <LoadingIndicator formation={service.formation} />
        </div>
      )}

      {/* ─── Calling points ─── */}
      <div className="mx-4 mt-4 pb-4">
        {service.callingPoints && service.callingPoints.length > 0 ? (
          <>
            <h4 className="text-xs font-medium text-text-secondary mb-2">
              Calling points
            </h4>
            <CallingPoints points={service.callingPoints} currentCrs={stationCrs} />
          </>
        ) : (
          <p className="text-text-muted text-sm">No calling point data available</p>
        )}
      </div>

      {/* ─── Service IDs (subtle footer) ─── */}
      <div className="px-4 py-3 border-t border-border-default text-[10px] text-text-muted font-mono flex gap-4">
        <span>RID: {service.rid}</span>
        {service.uid && <span>UID: {service.uid}</span>}
        {service.serviceId && <span>LDBWS: {service.serviceId}</span>}
        {service.length && <span>{service.length} coaches</span>}
      </div>
    </div>
  );
}