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
 * Midnight crossover: Times are normalised to be monotonically increasing
 * based on the calling point sort_time.
 *
 * Supports both light and dark mode via Tailwind utility classes.
 */

import type { HybridCallingPoint } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime } from "@railly-app/shared";

interface CallingPointsProps {
  points: HybridCallingPoint[];
  /** CRS of the current station (highlighted in the list) */
  currentCrs?: string | null;
}

/** Get current UK-local time as minutes since midnight */
function getUkNowMinutes(): number {
  const now = new Date();
  const ukTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = ukTime.split(":").map(Number);
  return h * 60 + m;
}

/** Parse time string to raw minutes since midnight (no midnight adjustment) */
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const formatted = formatDisplayTime(time);
  if (!formatted) return null;
  const [h, m] = formatted.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Normalise calling point times to be monotonically increasing.
 * If a stop's raw time ≤ previous stop's raw time, add 1440 (next day).
 */
function normaliseCallingPointTimes(points: HybridCallingPoint[]): number[] {
  const normalised: number[] = [];
  let prevMinutes = -1;

  for (const cp of points) {
    const effectiveTime = cp.etdPushport || cp.etaPushport || cp.ptdTimetable || cp.ptaTimetable;
    const raw = timeToMinutes(effectiveTime);

    if (raw === null) {
      normalised.push(prevMinutes + 1);
      prevMinutes = prevMinutes + 1;
    } else if (raw <= prevMinutes) {
      normalised.push(raw + 1440);
      prevMinutes = raw + 1440;
    } else {
      normalised.push(raw);
      prevMinutes = raw;
    }
  }

  return normalised;
}

/** Normalise nowMinutes for services crossing midnight */
function normaliseNowMinutes(nowMinutes: number, firstNormalisedTime: number): number {
  if (nowMinutes < firstNormalisedTime && firstNormalisedTime > 1200) {
    return nowMinutes + 1440;
  }
  return nowMinutes;
}

/** Calculate delay in minutes between scheduled and estimated/actual.
 *  Handles midnight crossings in both directions. */
function calculateDelay(scheduled: string | null, estimated: string | null, actual: string | null): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref || ref === "On time" || ref === "Cancelled" || ref === "cancelled") return null;
  const schedMins = timeToMinutes(scheduled);
  const refMins = timeToMinutes(ref);
  if (schedMins === null || refMins === null) return null;
  let d = refMins - schedMins;
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;
  return d;
}

type StopState = "past" | "current" | "future";

function determineStopState(
  ataPushport: string | null,
  atdPushport: string | null,
  normalisedTime: number,
  isFirstUpcoming: boolean,
  nowMinutes: number
): StopState {
  if (ataPushport || atdPushport) return "past";
  if (normalisedTime <= nowMinutes) return "past";
  if (isFirstUpcoming) return "current";
  return "future";
}

/** Platform badge component for a calling point */
function CpPlatformBadge({
  platTimetable,
  platPushport,
  isPast,
}: {
  platTimetable: string | null;
  platPushport: string | null;
  isPast: boolean;
}) {
  const bookedPlat = platTimetable?.trim() || null;
  const livePlat = platPushport?.trim() || null;
  const displayPlat = livePlat || bookedPlat;

  if (!displayPlat) return null;

  // If live differs from booked, show both
  if (livePlat && bookedPlat && livePlat !== bookedPlat) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-mono">
        <span className={`px-1 rounded line-through opacity-60 ${
          isPast
            ? "bg-gray-200 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
            : "bg-gray-200 text-gray-400 dark:bg-slate-700 dark:text-slate-400"
        }`}>
          {bookedPlat}
        </span>
        <span className="text-gray-400 dark:text-slate-500">→</span>
        <span className={`px-1 rounded ${
          isPast
            ? "bg-emerald-100 text-emerald-700 dark:bg-green-900 dark:text-green-300"
            : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        }`}>
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
          ? "bg-emerald-100 text-emerald-700 dark:bg-green-900 dark:text-green-300"
          : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        : isPast
          ? "bg-gray-200 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
          : "bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-400"
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
      isLate ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-green-400"
    }`}>
      {isLate ? `+${delay}` : delay} min
    </span>
  );
}

/** Checkmark icon for visited stops */
function CheckIcon() {
  return (
    <svg className="w-3 h-3 text-emerald-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** Individual calling point row */
function CallingPointRow({
  name,
  crs,
  ptaTimetable,
  ptdTimetable,
  etaPushport,
  etdPushport,
  ataPushport,
  atdPushport,
  platTimetable,
  platPushport,
  isCancelled,
  cancelReason,
  stopState,
  isLast,
}: {
  name: string | null;
  crs: string | null;
  ptaTimetable: string | null;
  ptdTimetable: string | null;
  etaPushport: string | null;
  etdPushport: string | null;
  ataPushport: string | null;
  atdPushport: string | null;
  platTimetable: string | null;
  platPushport: string | null;
  isCancelled: boolean;
  cancelReason: string | null;
  stopState: StopState;
  isLast: boolean;
}) {
  const displayName = normaliseStationName(name) || crs || "Unknown";
  const displayCrs = crs || "";

  const isCurrent = stopState === "current";
  const isPast = stopState === "past";
  const visited = !!ataPushport || !!atdPushport;

  // Determine which times to show: prefer departure times, fall back to arrival
  const hasDeparture = ptdTimetable !== null || etdPushport !== null || atdPushport !== null;
  const scheduled = formatDisplayTime(hasDeparture ? ptdTimetable : ptaTimetable);
  const estimated = formatDisplayTime(hasDeparture ? etdPushport : etaPushport);
  const actual = formatDisplayTime(hasDeparture ? atdPushport : ataPushport);

  // Delay: use actual vs scheduled, or estimated vs scheduled
  const delay = calculateDelay(hasDeparture ? ptdTimetable : ptaTimetable, estimated, actual);

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
                ? "border-emerald-500 bg-emerald-500 dark:border-green-500 dark:bg-green-500"
                : isPast
                  ? "border-emerald-500/60 bg-emerald-500/20 dark:border-green-500/60 dark:bg-green-500/20"
                    : isCurrent
                    ? "border-amber-500 bg-amber-500 dark:border-yellow-400 dark:bg-yellow-400"
                    : "border-gray-300 bg-gray-100 dark:border-slate-600 dark:bg-slate-800"
          }`}
        >
          {visited && <CheckIcon />}
        </div>
        {/* Connector line */}
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[1.5rem] ${
            isPast
              ? "bg-emerald-500 dark:bg-green-600"
              : "bg-gray-200 dark:bg-slate-700"
          }`} />
        )}
      </div>

      {/* Stop info */}
      <div className="flex-1 min-w-0 pb-3">
        {/* Name row with platform + CRS */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${
            isCancelled
              ? "line-through text-red-600 dark:text-red-400"
              : isCurrent
                ? "text-amber-700 dark:text-yellow-300"
                : isPast
                  ? visited
                    ? "text-emerald-700 dark:text-green-300"
                    : "text-gray-500 dark:text-slate-300"
                  : "text-gray-900 dark:text-slate-200"
          }`}>
            {displayName}
            {isCurrent && (
              <span className="ml-2 text-[10px] font-medium text-amber-600 dark:text-yellow-400 uppercase tracking-wider">
                Next
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <CpPlatformBadge platTimetable={platTimetable} platPushport={platPushport} isPast={isPast} />
            <span className="text-[11px] font-mono text-gray-400 dark:text-slate-600">{displayCrs}</span>
          </div>
        </div>

        {/* Time row */}
        <div className="flex items-center gap-2 mt-0.5">
          {/* Cancelled */}
          {isCancelled && (
            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
              Cancelled{cancelReason ? `: ${cancelReason}` : ""}
            </span>
          )}

          {/* Not cancelled — show times */}
          {!isCancelled && (
            <>
              {/* Actual time (visited) */}
              {actual && (
                <span className="text-xs font-mono font-medium text-emerald-600 dark:text-green-400">
                  {actual}
                </span>
              )}

              {/* Scheduled time — strikethrough if delayed and not visited */}
              {scheduled && (
                <span className={`text-xs font-mono ${
                  actual
                    ? "text-gray-400 line-through dark:text-slate-500"
                    : (estimated && estimated !== "On time" && scheduled !== estimated)
                      ? "text-gray-400 line-through dark:text-slate-500"
                      : "text-gray-500 dark:text-slate-400"
                }`}>
                  {scheduled}
                </span>
              )}

              {/* Estimated time (if not visited) */}
              {estimated && !actual && (
                estimated === "On time" ? (
                  <span className="text-xs font-mono text-emerald-600 dark:text-green-400">
                    On time
                  </span>
                ) : scheduled && estimated !== scheduled ? (
                  <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                    Exp {estimated}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    {estimated}
                  </span>
                )
              )}

              {/* Delay badge */}
              {!actual && <DelayBadge delay={delay} />}

              {/* Visited status text */}
              {actual && (
                <span className="text-[10px] text-emerald-600/80 dark:text-green-400/80">
                  {atdPushport ? "Departed" : "Arrived"}
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
  // Filter out non-passenger stops: PP (passing point), OPOR (operational origin),
  // OPIP (operational intermediate), OPDT (operational destination).
  // Only passenger stop types are: IP, OR, DT.
  // Also filter out phantom stops with no CRS and no public times (defence in depth).
  const NON_PASSENGER_STOP_TYPES = new Set(["PP", "OPOR", "OPIP", "OPDT"]);
  const displayPoints = points.filter((cp) => {
    if (NON_PASSENGER_STOP_TYPES.has(cp.stopType)) return false;
    if (!cp.crs && !cp.ptaTimetable && !cp.ptdTimetable) return false;
    return true;
  });

  if (displayPoints.length === 0) {
    return (
      <div className="text-xs text-gray-400 dark:text-slate-500 italic py-2">
        No calling point data available
      </div>
    );
  }

  const normalisedTimes = normaliseCallingPointTimes(displayPoints);

  const rawNowMinutes = getUkNowMinutes();
  const nowMinutes = normaliseNowMinutes(rawNowMinutes, normalisedTimes[0]);

  // Find first upcoming stop (for yellow dot)
  let firstUpcomingIndex = -1;
  for (let i = 0; i < displayPoints.length; i++) {
    const cp = displayPoints[i];
    if (cp.stopType === "PP") continue;
    if (cp.ataPushport || cp.atdPushport) continue;
    if (normalisedTimes[i] > nowMinutes) {
      firstUpcomingIndex = i;
      break;
    }
  }

  const currentStationIndex = currentCrs
    ? displayPoints.findIndex(cp => cp.crs === currentCrs)
    : -1;

  return (
    <div className="py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-2 font-semibold">
        Calling Points
      </div>
      {displayPoints.map((cp, i) => {
        const isFirstUpcoming = i === firstUpcomingIndex;

        const stopState = determineStopState(
          cp.ataPushport,
          cp.atdPushport,
          normalisedTimes[i],
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
            ptaTimetable={cp.ptaTimetable}
            ptdTimetable={cp.ptdTimetable}
            etaPushport={cp.etaPushport}
            etdPushport={cp.etdPushport}
            ataPushport={cp.ataPushport}
            atdPushport={cp.atdPushport}
            platTimetable={cp.platTimetable}
            platPushport={cp.platPushport}
            isCancelled={cp.isCancelled}
            cancelReason={cp.cancelReason ?? null}
            stopState={finalState}
            isLast={i === displayPoints.length - 1}
          />
        );
      })}
    </div>
  );
}