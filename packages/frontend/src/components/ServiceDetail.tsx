/**
 * ServiceDetail — Full-screen detail view for a single train service
 *
 * Shows calling pattern with time-based dots, alerts, formation, and service IDs.
 * Navigated to from ServiceRow click — no inline expansion.
 * Supports in-place refresh via onRefresh callback.
 */

import type { HybridBoardService, PlatformSource } from "@railly-app/shared";
import { CallingPoints } from "./CallingPoints";
import { LoadingIndicator } from "./LoadingIndicator";

interface ServiceDetailProps {
  service: HybridBoardService;
  isArrival: boolean;
  stationCrs: string;
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/** Format a rail time string (e.g. "0930" → "09:30") */
function formatTime(time: string | null | undefined): string {
  if (!time) return "--:--";
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  return cleaned;
}

/** Parse HH:MM to minutes since midnight for delay calc */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const t = formatTime(time);
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Compute delay in minutes between scheduled and estimated/actual */
function computeDelay(scheduled: string | null, estimated: string | null, actual: string | null): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref) return null;
  if (ref === "Cancelled") return null;
  if (ref === "On time") return 0;
  const s = parseTimeToMinutes(scheduled);
  const e = parseTimeToMinutes(ref);
  if (s === null || e === null) return null;
  let d = e - s;
  if (d < -720) d += 1440;
  return d;
}

/** Platform badge for service detail — same styling as board row but larger */
function PlatformBadge({ platformTimetable, platformLive, platformSource }: {
  platformTimetable: string | null;
  platformLive: string | null;
  platformSource: PlatformSource;
}) {
  if (!platformTimetable && !platformLive) {
    return <span className="platform platform-none text-lg px-3 py-1">—</span>;
  }

  switch (platformSource) {
    case "confirmed":
      return <span className="platform platform-confirmed text-lg px-3 py-1">{platformLive || platformTimetable}</span>;

    case "altered":
      return (
        <span className="platform platform-altered text-lg px-3 py-1">
          <span className="platform-booked">{platformTimetable}</span>
          <span className="platform-arrow">→</span>
          <span className="platform-live">{platformLive}</span>
        </span>
      );

    case "suppressed":
      return (
        <span className="platform platform-suppressed text-lg px-3 py-1">
          {platformLive}
          <span className="suppressed-indicator">✱</span>
        </span>
      );

    case "expected":
      return <span className="platform platform-expected text-lg px-3 py-1">—</span>;

    case "scheduled":
      return <span className="platform platform-scheduled text-lg px-3 py-1">{platformTimetable}</span>;

    default:
      return <span className="platform text-lg px-3 py-1">{platformLive || platformTimetable}</span>;
  }
}

export function ServiceDetail({ service, isArrival, stationCrs, onBack, onRefresh, isRefreshing }: ServiceDetailProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const destination = isArrival ? service.origin : service.destination;
  const origin = isArrival ? service.destination : service.origin;

  const cancelled = service.isCancelled || estimatedTime === "Cancelled" || estimatedTime === "cancelled";
  const onTime = !cancelled && estimatedTime === "On time";
  const delay = computeDelay(scheduledTime, estimatedTime, actualTime);
  const isDelayed = !cancelled && delay !== null && delay > 1;

  return (
    <div className="service-detail flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1 -ml-1"
          aria-label="Back to board"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-mono font-bold text-gray-900 dark:text-white">
              {formatTime(scheduledTime)}
            </span>
            {actualTime && (
              <span className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {formatTime(actualTime)}
              </span>
            )}
            {!actualTime && estimatedTime && !onTime && !cancelled && (
              <span className="text-xl font-mono font-bold text-amber-600 dark:text-amber-400">
                {formatTime(estimatedTime)}
              </span>
            )}
            {onTime && (
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">On time</span>
            )}
            {cancelled && (
              <span className="text-sm font-medium text-red-600 dark:text-red-400">Cancelled</span>
            )}
          </div>
          <div className="text-sm text-gray-500 dark:text-slate-400 truncate">
            {destination?.name || destination?.crs || "Unknown"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="refresh-press text-gray-400 hover:text-gray-900 dark:hover:text-white p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
              aria-label="Refresh service"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}

          {/* Platform badge */}
          <div className="shrink-0">
            <PlatformBadge
              platformTimetable={service.platformTimetable}
              platformLive={service.platformLive}
              platformSource={service.platformSource}
            />
          </div>
        </div>
      </div>

      {/* Alerts */}
      {cancelled && service.cancelReason && (
        <div className="mx-4 mt-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <strong>Cancelled:</strong> {service.cancelReason}
        </div>
      )}
      {isDelayed && service.delayReason && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-amber-700 dark:text-amber-300 text-sm">
          <strong>Delayed {delay} min:</strong> {service.delayReason}
        </div>
      )}
      {service.platformSource === "altered" && service.platformLive && service.platformTimetable !== service.platformLive && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg text-amber-700 dark:text-amber-300 text-sm">
          Platform altered from {service.platformTimetable} to {service.platformLive}
        </div>
      )}
      {service.adhocAlerts?.map((alert, i) => (
        <div key={i} className="mx-4 mt-3 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg text-blue-700 dark:text-blue-300 text-sm">
          {alert}
        </div>
      ))}

      {/* Current location indicator */}
      {service.currentLocation && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            service.currentLocation.status === "at_platform" ? "bg-emerald-500 dark:bg-emerald-400" :
            service.currentLocation.status === "approaching" ? "bg-amber-500 dark:bg-amber-400" :
            "bg-gray-400 dark:bg-slate-400"
          }`} />
          <span>
            {service.currentLocation.status === "at_platform" ? "At platform" :
             service.currentLocation.status === "approaching" ? "Approaching" :
             "Departed"} {service.currentLocation.name || service.currentLocation.crs || service.currentLocation.tpl}
          </span>
        </div>
      )}

      {/* Time comparison table */}
      <div className="mx-4 mt-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-500 border-b border-gray-200 dark:border-slate-700">
              <th className="py-1 font-medium">Event</th>
              <th className="py-1 font-medium">Scheduled</th>
              <th className="py-1 font-medium">Real-time</th>
              <th className="py-1 font-medium">Delay</th>
            </tr>
          </thead>
          <tbody className="text-gray-700 dark:text-slate-300">
            {service.sta && (
              <tr className="border-b border-gray-100 dark:border-slate-700/50">
                <td className="py-1.5">Arrival</td>
                <td className="py-1.5 font-mono">{formatTime(service.sta)}</td>
                <td className="py-1.5 font-mono">
                  {service.actualArrival ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{formatTime(service.actualArrival)}</span>
                  ) : service.eta ? (
                    <span className={service.eta === "On time" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {formatTime(service.eta)}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-slate-500">--:--</span>
                  )}
                </td>
                <td className="py-1.5">
                  {(() => {
                    const delay = computeDelay(service.sta, service.eta, service.actualArrival);
                    if (delay === null) return <span className="text-gray-400 dark:text-slate-500">--</span>;
                    return (
                      <span className={delay > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                        {delay > 0 ? "+" : ""}{delay} min
                      </span>
                    );
                  })()}
                </td>
              </tr>
            )}
            {service.std && (
              <tr>
                <td className="py-1.5">Departure</td>
                <td className="py-1.5 font-mono">{formatTime(service.std)}</td>
                <td className="py-1.5 font-mono">
                  {service.actualDeparture ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{formatTime(service.actualDeparture)}</span>
                  ) : service.etd ? (
                    <span className={service.etd === "On time" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {formatTime(service.etd)}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-slate-500">--:--</span>
                  )}
                </td>
                <td className="py-1.5">
                  {(() => {
                    const delay = computeDelay(service.std, service.etd, service.actualDeparture);
                    if (delay === null) return <span className="text-gray-400 dark:text-slate-500">--</span>;
                    return (
                      <span className={delay > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                        {delay > 0 ? "+" : ""}{delay} min
                      </span>
                    );
                  })()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Route info */}
      <div className="mx-4 mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
        <span>{origin?.name || origin?.crs || "Unknown"}</span>
        <span className="text-gray-300 dark:text-slate-600">→</span>
        <span>{destination?.name || destination?.crs || "Unknown"}</span>
        {service.tocName && (
          <>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <span>{service.tocName}</span>
          </>
        )}
        {service.trainId && (
          <>
            <span className="text-gray-300 dark:text-slate-600">·</span>
            <span className="font-mono text-gray-400 dark:text-slate-500">{service.trainId}</span>
          </>
        )}
      </div>

      {/* Formation */}
      {service.formation && service.formation.coaches && (
        <div className="mx-4 mt-3">
          <h4 className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Formation</h4>
          <LoadingIndicator formation={service.formation} />
        </div>
      )}

      {/* Calling points */}
      <div className="mx-4 mt-4 flex-1 overflow-y-auto pb-4">
        {service.callingPoints && service.callingPoints.length > 0 ? (
          <>
            <h4 className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-2">Calling points</h4>
            <CallingPoints
              points={service.callingPoints}
              currentCrs={stationCrs}
            />
          </>
        ) : (
          <p className="text-gray-400 dark:text-slate-500 text-sm">No calling point data available</p>
        )}
      </div>

      {/* Service IDs (subtle footer) */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 text-[10px] text-gray-400 dark:text-slate-600 font-mono flex gap-4">
        <span>RID: {service.rid}</span>
        {service.uid && <span>UID: {service.uid}</span>}
        {service.serviceId && <span>LDBWS: {service.serviceId}</span>}
        {service.length && <span>{service.length} coaches</span>}
      </div>
    </div>
  );
}