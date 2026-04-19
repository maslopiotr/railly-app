/**
 * CallingPoints — Displays the calling pattern for a hybrid service
 *
 * Shows all stops in a timeline format with both planned times
 * (from timetable) and real-time estimates (from LDBWS overlay).
 */

import type { HybridCallingPoint } from "@railly-app/shared";

interface CallingPointsProps {
  points: HybridCallingPoint[];
  /** CRS of the current station (highlighted in the list) */
  currentCrs?: string | null;
}

/** Format a rail time string (HH:MM or HHmm) to HH:MM */
function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  return cleaned;
}

function CallingPointRow({
  name,
  crs,
  pta,
  ptd,
  eta,
  etd,
  plat,
  platformLive,
  isCancelled,
  isCurrent,
  isFirst,
  isLast,
  stopType,
}: {
  name: string | null;
  crs: string | null;
  pta: string | null;
  ptd: string | null;
  eta: string | null;
  etd: string | null;
  plat: string | null;
  platformLive: string | null;
  isCancelled: boolean;
  isCurrent?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  stopType: string;
}) {
  const displayName = name || crs || "Unknown";
  const displayCrs = crs || "";

  // Determine which times to show
  // For departure-type stops: show ptd/etd
  // For arrival-type stops: show pta/eta
  const isDest = stopType === "DT";
  const showDeparture = ptd !== null;

  const scheduledTime = formatTime(showDeparture ? ptd : pta);
  const estimatedTime = formatTime(showDeparture ? etd : eta);

  const isOnTime = estimatedTime === "On time" || estimatedTime === scheduledTime;
  const isDelayed = estimatedTime && !isOnTime && estimatedTime !== scheduledTime;

  // Platform display
  const displayPlatform = platformLive || plat;

  return (
    <div className={`flex items-start gap-3 group ${isCurrent ? "current-stop" : ""}`}>
      {/* Timeline dot */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full border-2 mt-1.5 ${
            isCancelled
              ? "border-red-500 bg-red-500"
              : isCurrent
                ? "border-yellow-400 bg-yellow-400"
                : isFirst
                  ? "border-green-400 bg-green-400"
                  : isDest
                    ? "border-red-400 bg-red-400"
                    : "border-slate-500 bg-slate-800"
          }`}
        />
        {!isLast && <div className="w-0.5 h-6 bg-slate-700" />}
      </div>

      {/* Stop info */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${isCancelled ? "line-through text-red-400" : isCurrent ? "text-yellow-300" : "text-slate-200"}`}>
            {displayName}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {displayPlatform && (
              <span className={`text-[10px] font-mono px-1 rounded ${
                platformLive ? "bg-blue-900 text-blue-300" : "bg-slate-700 text-slate-400"
              }`}>
                {displayPlatform}
              </span>
            )}
            <span className="text-[10px] font-mono text-slate-600">{displayCrs}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Planned time */}
          {scheduledTime && (
            <span className="text-slate-400">{scheduledTime}</span>
          )}
          {/* Real-time estimate */}
          {estimatedTime && !isCancelled && (
            <span className={isOnTime ? "text-green-400" : isDelayed ? "text-yellow-400" : "text-slate-400"}>
              {estimatedTime}
            </span>
          )}
          {isCancelled && (
            <span className="text-red-400 font-medium">Cancelled</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CallingPoints({ points, currentCrs }: CallingPointsProps) {
  if (points.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic py-2">
        No calling point data available
      </div>
    );
  }

  return (
    <div className="py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">
        Route
      </div>
      {points.map((cp, i) => (
        <CallingPointRow
          key={`${cp.tpl}-${i}`}
          name={cp.name}
          crs={cp.crs}
          pta={cp.pta}
          ptd={cp.ptd}
          eta={cp.eta}
          etd={cp.etd}
          plat={cp.plat}
          platformLive={cp.platformLive}
          isCancelled={cp.isCancelled}
          isCurrent={cp.crs === currentCrs}
          isFirst={cp.stopType === "OR"}
          isLast={cp.stopType === "DT"}
          stopType={cp.stopType}
        />
      ))}
    </div>
  );
}