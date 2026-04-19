/**
 * CallingPoints — Displays the calling pattern for a hybrid service
 *
 * Shows all stops in a timeline format with both planned times
 * (from timetable) and real-time estimates (from LDBWS overlay).
 *
 * Visual indicators (time-based, Kafka-ready):
 * - Green filled dot: Train has been at this stop
 *   → Now: scheduled/estimated time has passed vs current time
 *   → Later (Kafka): ata/atd actual times will override
 * - Yellow pulsing dot: Next stop the train will reach (first upcoming)
 * - Grey hollow dot: Future stops (after the next one)
 * - Red time + delay: Late arrival/departure
 *
 * Midnight crossover: Times are normalized to be monotonically increasing
 * based on the calling point sequence. If a stop's raw time ≤ previous stop's
 * raw time, 1440 (24h) is added. If viewing after midnight for a service that
 * started before midnight, nowMinutes is also adjusted.
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
 * Returns an array of normalized minutes parallel to the input points.
 */
function normalizeCallingPointTimes(points: HybridCallingPoint[]): number[] {
  const normalized: number[] = [];
  let prevMinutes = -1;

  for (const cp of points) {
    const effectiveTime = cp.etd || cp.eta || cp.ptd || cp.pta;
    const raw = timeToMinutes(effectiveTime);

    if (raw === null) {
      // No time — carry forward previous + 1 to maintain ordering
      normalized.push(prevMinutes + 1);
      prevMinutes = prevMinutes + 1;
    } else if (raw <= prevMinutes) {
      // Time went backwards → crossed midnight → add 24h
      normalized.push(raw + 1440);
      prevMinutes = raw + 1440;
    } else {
      normalized.push(raw);
      prevMinutes = raw;
    }
  }

  return normalized;
}

/**
 * Normalize nowMinutes for comparison against a service's normalized times.
 *
 * If we're viewing after midnight (e.g. 00:30 = 30 min) but the service
 * started before midnight (first normalized time > 1440), we need to
 * add 1440 to nowMinutes so the comparison works correctly.
 */
function normalizeNowMinutes(nowMinutes: number, firstNormalizedTime: number): number {
  if (nowMinutes < firstNormalizedTime && firstNormalizedTime > 1200) {
    // We're after midnight, service started yesterday
    return nowMinutes + 1440;
  }
  return nowMinutes;
}

/** Calculate delay in minutes between scheduled and estimated */
function calculateDelay(scheduled: string | null, estimated: string | null): number | null {
  if (!scheduled || !estimated) return null;
  if (estimated === "On time") return 0;

  const schedMins = timeToMinutes(scheduled);
  const estMins = timeToMinutes(estimated);

  if (schedMins === null || estMins === null) return null;

  // Handle midnight crossover for delay too
  const delay = estMins - schedMins;
  return delay < -720 ? delay + 1440 : delay;
}

/**
 * Determine if a stop is in the past, current, or future.
 *
 * Priority:
 * 1. If ata/atd exist → past (Kafka actual times)
 * 2. Compare normalized time to now → past if time has passed
 * 3. First stop whose time hasn't passed → current (yellow)
 * 4. Everything after → future (grey)
 */
type StopState = "past" | "current" | "future";

function determineStopState(
  ata: string | null,
  atd: string | null,
  normalizedTime: number,
  isFirstUpcoming: boolean,
  nowMinutes: number
): StopState {
  // If we have actual times (from Kafka), this stop is definitely past
  if (ata || atd) return "past";

  if (normalizedTime <= nowMinutes) {
    return "past";
  }

  // First stop whose time hasn't passed yet
  if (isFirstUpcoming) return "current";

  return "future";
}

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
}) {
  const displayName = name || crs || "Unknown";
  const displayCrs = crs || "";

  // Determine which times to show
  const showDeparture = ptd !== null;

  const scheduledTime = formatTime(showDeparture ? ptd : pta);
  const estimatedTime = formatTime(showDeparture ? etd : eta);
  const actualTime = formatTime(showDeparture ? atd : ata);

  // Calculate delay
  const delay = calculateDelay(scheduledTime, estimatedTime);
  const isOnTime = estimatedTime === "On time" || delay === 0;
  const isLate = delay !== null && delay > 0;

  // Platform display
  const displayPlatform = platformLive || plat;

  const isCurrent = stopState === "current";
  const isPast = stopState === "past";

  return (
    <div className={`flex items-start gap-3 group ${isCurrent ? "current-stop" : ""}`}>
      {/* Timeline dot */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full border-2 mt-1.5 ${
            isCancelled
              ? "border-red-500 bg-red-500"
              : isPast
                ? "border-green-500 bg-green-500"
                : isCurrent
                  ? "border-yellow-400 bg-yellow-400 animate-pulse"
                  : "border-slate-500 bg-slate-800"
          }`}
        />
        <div className={`w-0.5 h-6 ${isPast ? "bg-green-600" : "bg-slate-700"}`} />
      </div>

      {/* Stop info */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${
            isCancelled
              ? "line-through text-red-400"
              : isCurrent
                ? "text-yellow-300"
                : isPast
                  ? "text-slate-300"
                  : "text-slate-200"
          }`}>
            {displayName}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {displayPlatform && (
              <span className={`text-[11px] font-mono px-1 rounded ${
                platformLive ? "bg-blue-900 text-blue-300" : "bg-slate-700 text-slate-400"
              }`}>
                {displayPlatform}
              </span>
            )}
            <span className="text-[11px] font-mono text-slate-600">{displayCrs}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Show actual time if available (train has been there — Kafka) */}
          {actualTime && (
            <span className="text-green-400 font-medium">{actualTime}</span>
          )}

          {/* Show scheduled time */}
          {scheduledTime && !actualTime && (
            <span className="text-slate-400">{scheduledTime}</span>
          )}

          {/* Show estimated time with delay indicator */}
          {estimatedTime && !isCancelled && !actualTime && (
            <span className={`font-mono ${
              isOnTime
                ? "text-green-400"
                : isLate
                  ? "text-red-400"
                  : "text-slate-400"
            }`}>
              {estimatedTime}
              {isLate && delay !== null && (
                <span className="text-red-400 ml-1">(+{delay})</span>
              )}
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

  // Normalize calling point times to handle midnight crossover
  const normalizedTimes = normalizeCallingPointTimes(points);

  // Get current time and normalize for comparison
  const now = new Date();
  const rawNowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowMinutes = normalizeNowMinutes(rawNowMinutes, normalizedTimes[0]);

  // Find the first "upcoming" stop index (for yellow dot)
  let firstUpcomingIndex = -1;
  for (let i = 0; i < points.length; i++) {
    const cp = points[i];
    // Skip passing points
    if (cp.stopType === "PP") continue;

    // If we have actual times, this is past
    if (cp.ata || cp.atd) continue;

    // Use normalized time for comparison
    if (normalizedTimes[i] > nowMinutes) {
      firstUpcomingIndex = i;
      break;
    }
  }

  // Find current station in the list (for highlighting)
  const currentStationIndex = currentCrs
    ? points.findIndex(cp => cp.crs === currentCrs)
    : -1;

  return (
    <div className="py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">
        Route
      </div>
      {points.map((cp, i) => {
        const isFirstUpcoming = i === firstUpcomingIndex;

        const stopState = determineStopState(
          cp.ata,
          cp.atd,
          normalizedTimes[i],
          isFirstUpcoming,
          nowMinutes
        );

        // Override: only mark current station as "current" (yellow)
        // if the time-based state is "future" (train hasn't reached it yet).
        // If the train has already departed, keep it as "past" (green).
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
          />
        );
      })}
    </div>
  );
}