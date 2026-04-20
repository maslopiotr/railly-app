/**
 * ServiceDetail — Full-screen detail view for a single train service
 *
 * Shows calling pattern with time-based dots, alerts, formation, and service IDs.
 * Navigated to from ServiceRow click — no inline expansion.
 * Supports in-place refresh via onRefresh callback.
 */

import type { HybridBoardService } from "@railly-app/shared";
import { CallingPoints } from "./CallingPoints";
import { LoadingIndicator } from "./LoadingIndicator";

interface ServiceDetailProps {
  service: HybridBoardService;
  isArrival: boolean;
  stationCrs: string;
  onBack: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastUpdated?: Date | null;
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

export function ServiceDetail({ service, isArrival, stationCrs, onBack, onRefresh, isRefreshing, lastUpdated }: ServiceDetailProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const destination = isArrival ? service.origin : service.destination;
  const origin = isArrival ? service.destination : service.origin;

  const cancelled = service.isCancelled || estimatedTime === "Cancelled" || estimatedTime === "cancelled";
  const onTime = !cancelled && estimatedTime === "On time";
  const delayed = !cancelled && !onTime && estimatedTime && estimatedTime !== scheduledTime;

  return (
    <div className="service-detail flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors p-1 -ml-1"
          aria-label="Back to board"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-mono font-bold text-white">
              {formatTime(scheduledTime)}
            </span>
            {estimatedTime && !onTime && !cancelled && (
              <span className="text-xl font-mono font-bold text-amber-400">
                {formatTime(estimatedTime)}
              </span>
            )}
            {onTime && (
              <span className="text-sm font-medium text-green-400">On time</span>
            )}
            {cancelled && (
              <span className="text-sm font-medium text-red-400">Cancelled</span>
            )}
          </div>
          <div className="text-sm text-slate-400 truncate">
            {destination?.name || destination?.crs || "Unknown"}
          </div>
          {lastUpdated && (
            <div className="text-[10px] text-slate-500 mt-0.5">
              Updated {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="refresh-press text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-50"
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

          {/* Platform */}
          <div className="text-center shrink-0">
            <div className={`text-2xl font-bold font-mono ${
              !service.platform ? "text-slate-600" :
              service.platformSource === "confirmed" ? "text-blue-400" :
              service.platformSource === "altered" ? "text-amber-400" :
              "text-slate-400"
            }`}>
              {service.platform || "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Plat</div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {cancelled && service.cancelReason && (
        <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
          <strong>Cancelled:</strong> {service.cancelReason}
        </div>
      )}
      {delayed && service.delayReason && (
        <div className="mx-4 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-sm">
          <strong>Delayed:</strong> {service.delayReason}
        </div>
      )}
      {service.platformSource === "altered" && (
        <div className="mx-4 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-sm">
          Platform altered from {service.platform} to {service.platformLive}
        </div>
      )}
      {service.adhocAlerts?.map((alert, i) => (
        <div key={i} className="mx-4 mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-300 text-sm">
          {alert}
        </div>
      ))}

      {/* Route info */}
      <div className="mx-4 mt-4 flex items-center gap-2 text-xs text-slate-400">
        <span>{origin?.name || origin?.crs || "Unknown"}</span>
        <span className="text-slate-600">→</span>
        <span>{destination?.name || destination?.crs || "Unknown"}</span>
        {service.tocName && (
          <>
            <span className="text-slate-600">·</span>
            <span>{service.tocName}</span>
          </>
        )}
        {service.trainId && (
          <>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-500">{service.trainId}</span>
          </>
        )}
      </div>

      {/* Formation */}
      {service.formation && service.formation.coaches && (
        <div className="mx-4 mt-3">
          <h4 className="text-xs font-medium text-slate-400 mb-1">Formation</h4>
          <LoadingIndicator formation={service.formation} />
        </div>
      )}

      {/* Calling points */}
      <div className="mx-4 mt-4 flex-1 overflow-y-auto pb-4">
        {service.callingPoints && service.callingPoints.length > 0 ? (
          <>
            <h4 className="text-xs font-medium text-slate-400 mb-2">Calling points</h4>
            <CallingPoints
              points={service.callingPoints}
              currentCrs={stationCrs}
            />
          </>
        ) : (
          <p className="text-slate-500 text-sm">No calling point data available</p>
        )}
      </div>

      {/* Service IDs (subtle footer) */}
      <div className="px-4 py-3 border-t border-slate-700 text-[10px] text-slate-600 font-mono flex gap-4">
        <span>RID: {service.rid}</span>
        {service.uid && <span>UID: {service.uid}</span>}
        {service.serviceId && <span>LDBWS: {service.serviceId}</span>}
        {service.length && <span>{service.length} coaches</span>}
      </div>
    </div>
  );
}