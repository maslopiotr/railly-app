/**
 * CallingPoints — Displays the calling pattern for a hybrid service
 *
 * Timeline format with both planned times and real-time estimates.
 * Enhanced features:
 * - Platform badges per calling point (booked vs live with visual distinction)
 * - Visited stops clearly marked with actual arrival/departure times and platform
 * - Delay per calling point shown as a badge
 * - Prominent current train position indicator
 *
 * Midnight crossover: Times are normalized to be monotonically increasing
 * based on the calling point sequence.
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

/** Parse time string to raw minutes since midnight (no midnight adjustment) */
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const formatted = formatTime(time);
  if (!formatted) return null;
  const [h, m] = formatted.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Normalize calling point times to be monotonically increasing.
 * If a stop's raw time ≤ previous stop's raw time, add 1440 (next day).
 */
function normalizeCallingPointTimes(points: HybridCallingPoint[]): number[] {
  const normalized: number[] = [];
  let prevMinutes = -1;

  for (const cp of points) {
    const effectiveTime = cp.etd || cp.eta || cp.ptd || cp.pta;
    const raw = timeToMinutes(effectiveTime);

    if (raw === null) {
      normalized.push(prevMinutes + 1);
      prevMinutes = prevMinutes + 1;
    } else if (raw <= prevMinutes) {
      normalized.push(raw + 1440);
      prevMinutes = raw + 1440;
    } else {
      normalized.push(raw);
      prevMinutes = raw;
    }
  }

  return normalized;
}

/** Normalize nowMinutes for services crossing midnight */
function normalizeNowMinutes(nowMinutes: number, firstNormalizedTime: number): number {
  if (nowMinutes < firstNormalizedTime && firstNormalizedTime > 1200) {
    return nowMinutes + 1440;
  }
  return nowMinutes;
}

/** Calculate delay in minutes between scheduled and estimated/actual */
function calculateDelay(scheduled: string | null, estimated: string | null, actual: string | null): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref || ref === "On time" || ref === "Cancelled" || ref === "cancelled") return null;
  const schedMins = timeToMinutes(scheduled);
  const refMins = timeToMinutes(ref);
  if (schedMins === null || refMins === null) return null;
  const d = refMins - schedMins;
  return d < -720 ? d + 1440 : d;
}

type StopState = "past" | "current" | "future";

function determineStopState(
  ata: string | null,
  atd: string | null,
  normalizedTime: number,
  isFirstUpcoming: boolean,
  nowMinutes: number
): StopState {
  if (ata || atd) return "past";
  if (normalizedTime <= nowMinutes) return "past";
  if (isFirstUpcoming) return "current";
  return "future";
}

/** Platform badge component for a calling point */
function PlatformBadge({
  plat,
  platformLive,
  isPast,
}: {
  plat: string | null;
  platformLive: string | null;
  isPast: boolean;
}) {
  const bookedPlat = plat?.trim() || null;
  const livePlat = platformLive?.trim() || null;
  const displayPlat = livePlat || bookedPlat;

  if (!displayPlat) return null;

  // If live differs from booked, show both
  if (livePlat && bookedPlat && livePlat !== bookedPlat) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-mono">
        <span className={`px-1 rounded line-through opacity-60 ${isPast ? "bg-slate-700 text-slate-500" : "bg-slate-700 text-slate-400"}`}>
          {bookedPlat}
        </span>
        <span className="text-slate-500">→</span>
        <span className={`px-1 rounded ${isPast ? "bg-green-900 text-green-300" : "bg-blue-900 text-blue-300"}`}>
          {livePlat}
        </span>
      </span>
    );
  }

  // Single platform
  return (
    <span className={`text-[11px] font-mono px-1 rounded ${
      livePlat
        ? isPast
          ? "bg-green-900 text-green-300"
          : "bg-blue-900 text-blue-300"
        : isPast
          ? "bg-slate-700 text-slate-500"
          : "bg-slate-700 text-slate-400"
    }`}>
      {displayPlat}
    </span>
  );
}

/** Delay badge showing minutes late/early */
function DelayBadge({ delay }: { delay: number | null }) {
  if (delay === null || delay === 0) return null;
  const isLate = delay > 0;
  return (
    <span className={`text-[10px] font-mono font-medium ${
      isLate ? "text-red-400" : "text-green-400"
    }`}>
      {isLate ? `+${delay}` : delay} min
    </span>
  );
}

/** Checkmark icon for visited stops */
function CheckIcon() {
  return (
    <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** Individual calling point row */
function CallingPointRow({
  name,
  crs,
  pta,
  ptd,
  eta,
  etd,
  ata,
  atd,
  plat,
  platformLive,
  isCancelled,
  stopState,
  isLast,
}: {
  name: string | null;
  crs: string | null;
  pta: string | null;
  ptd: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  plat: string | null;
  platformLive: string | null;
  isCancelled: boolean;
  stopState: StopState;
  isLast: boolean;
}) {
  const displayName = name || crs || "Unknown";
  const displayCrs = crs || "";

  const isCurrent = stopState === "current";
  const isPast = stopState === "past";
  const visited = !!ata || !!atd;

  // Determine which times to show: prefer departure times, fall back to arrival
  const hasDeparture = ptd !== null || etd !== null || atd !== null;
  const scheduled = formatTime(hasDeparture ? ptd : pta);
  const estimated = formatTime(hasDeparture ? etd : eta);
  const actual = formatTime(hasDeparture ? atd : ata);

  // Delay: use actual vs scheduled, or estimated vs scheduled
  const delay = calculateDelay(hasDeparture ? ptd : pta, estimated, actual);

  return (
    <div className={`flex items-start gap-3 group ${isCurrent ? "current-stop" : ""}`}>
      {/* Timeline column */}
      <div className="flex flex-col items-center">
        {/* Dot */}
        <div
          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center mt-1.5 shrink-0 ${
            isCancelled
              ? "border-red-500 bg-red-500"
              : visited
                ? "border-green-500 bg-green-500"
                : isPast
                  ? "border-green-500/60 bg-green-500/20"
                  : isCurrent
                    ? "border-yellow-400 bg-yellow-400 animate-pulse"
                    : "border-slate-600 bg-slate-800"
          }`}
        >
          {visited && <CheckIcon />}
        </div>
        {/* Connector line */}
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[1.5rem] ${
            isPast ? "bg-green-600" : "bg-slate-700"
          }`} />
        )}
      </div>

      {/* Stop info */}
      <div className="flex-1 min-w-0 pb-3">
        {/* Name row with platform + CRS */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${
            isCancelled
              ? "line-through text-red-400"
              : isCurrent
                ? "text-yellow-300"
                : isPast
                  ? visited
                    ? "text-green-300"
                    : "text-slate-300"
                  : "text-slate-200"
          }`}>
            {displayName}
            {isCurrent && (
              <span className="ml-2 text-[10px] font-medium text-yellow-400 uppercase tracking-wider">
                Next
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <PlatformBadge plat={plat} platformLive={platformLive} isPast={isPast} />
            <span className="text-[11px] font-mono text-slate-600">{displayCrs}</span>
          </div>
        </div>

        {/* Time row */}
        <div className="flex items-center gap-2 mt-0.5">
          {/* Cancelled */}
          {isCancelled && (
            <span className="text-xs text-red-400 font-medium">Cancelled</span>
          )}

          {/* Not cancelled — show times */}
          {!isCancelled && (
            <>
              {/* Actual time (visited) */}
              {actual && (
                <span className="text-xs font-mono font-medium text-green-400">
                  {actual}
                </span>
              )}

              {/* Scheduled time (strikethrough if visited) */}
              {scheduled && (
                <span className={`text-xs font-mono ${actual ? "text-slate-500 line-through" : "text-slate-400"}`}>
                  {scheduled}
                </span>
              )}

              {/* Estimated time (if not visited) */}
              {estimated && !actual && (
                <span className={`text-xs font-mono ${
                  estimated === "On time" ? "text-green-400" : "text-amber-400"
                }`}>
                  {estimated}
                </span>
              )}

              {/* Delay badge */}
              {!actual && <DelayBadge delay={delay} />}

              {/* Visited status text */}
              {actual && (
                <span className="text-[10px] text-green-400/80">
                  {atd ? "Departed" : "Arrived"}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CallingPoints({ points, currentCrs }: CallingPointsProps) {
  // Filter out passing points (PP) — these are operational junctions without
  // passenger stops and show raw TIPLOC codes like CMDNSTH, WLSDWLJ
  const displayPoints = points.filter((cp) => cp.stopType !== "PP");

  if (displayPoints.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic py-2">
        No calling point data available
      </div>
    );
  }

  const normalizedTimes = normalizeCallingPointTimes(displayPoints);

  const now = new Date();
  const rawNowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowMinutes = normalizeNowMinutes(rawNowMinutes, normalizedTimes[0]);

  // Find first upcoming stop (for yellow dot)
  let firstUpcomingIndex = -1;
  for (let i = 0; i < displayPoints.length; i++) {
    const cp = displayPoints[i];
    if (cp.stopType === "PP") continue;
    if (cp.ata || cp.atd) continue;
    if (normalizedTimes[i] > nowMinutes) {
      firstUpcomingIndex = i;
      break;
    }
  }

  const currentStationIndex = currentCrs
    ? displayPoints.findIndex(cp => cp.crs === currentCrs)
    : -1;

  return (
    <div className="py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">
        Calling Points
      </div>
      {displayPoints.map((cp, i) => {
        const isFirstUpcoming = i === firstUpcomingIndex;

        const stopState = determineStopState(
          cp.ata,
          cp.atd,
          normalizedTimes[i],
          isFirstUpcoming,
          nowMinutes
        );

        // Override current station to "current" if it's in the future
        const finalState: StopState =
          i === currentStationIndex && stopState === "future"
            ? "current"
            : stopState;

        return (
          <CallingPointRow
            key={`${cp.tpl}-${i}`}
            name={cp.name}
            crs={cp.crs}
            pta={cp.pta}
            ptd={cp.ptd}
            eta={cp.eta}
            etd={cp.etd}
            ata={cp.ata}
            atd={cp.atd}
            plat={cp.plat}
            platformLive={cp.platformLive}
            isCancelled={cp.isCancelled}
            stopState={finalState}
            isLast={i === displayPoints.length - 1}
          />
        );
      })}
    </div>
  );
}