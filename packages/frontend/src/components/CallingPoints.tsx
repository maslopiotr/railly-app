/**
 * CallingPoints — Displays the calling pattern for a hybrid service
 *
 * Timeline format with both planned times and real-time estimates.
 * Uses semantic design tokens for dots, connector lines, and text.
 * Delegates platform display to the shared PlatformBadge component.
 *
 * Filters to passenger stops only (IP, OR, DT). Non-passenger stops
 * (PP, OPOR, OPIP, OPDT, RM) and phantom stops with no CRS and no
 * public times are hidden.
 */

import type { HybridCallingPoint } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime, computeDelay } from "@railly-app/shared";
import { PlatformBadge } from "./PlatformBadge";

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
 * Uses the sort_time field from the DB as the authoritative ordering key.
 */
function normaliseCallingPointTimes(points: HybridCallingPoint[]): number[] {
  const normalised: number[] = [];
  let prevMinutes = -1;

  for (const cp of points) {
    const raw = timeToMinutes(cp.sortTime);

    if (raw === null) {
      const effectiveTime =
        cp.ptdTimetable || cp.ptaTimetable || cp.etdPushport || cp.etaPushport;
      const fallback = timeToMinutes(effectiveTime);
      if (fallback === null) {
        normalised.push(prevMinutes + 1);
        prevMinutes = prevMinutes + 1;
      } else if (fallback <= prevMinutes) {
        normalised.push(fallback + 1440);
        prevMinutes = fallback + 1440;
      } else {
        normalised.push(fallback);
        prevMinutes = fallback;
      }
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

type StopState = "past" | "current" | "future";

function determineStopState(
  ataPushport: string | null,
  atdPushport: string | null,
  normalisedTime: number,
  isFirstUpcoming: boolean,
  nowMinutes: number,
): StopState {
  if (atdPushport) return "past";
  if (ataPushport && !isFirstUpcoming) return "past";
  if (normalisedTime <= nowMinutes) return "past";
  if (isFirstUpcoming) return "current";
  return "future";
}

/**
 * Delay badge showing delay per calling point.
 * Coloured pill: green for on-time (≤1 min), amber for 2–14 min delay, red for ≥15 min.
 */
function DelayBadge({ delay }: { delay: number | null }) {
  if (delay === null) return null;

  const absDelay = Math.abs(delay);
  const isLate = delay > 0;

  if (!isLate || absDelay <= 1) {
    // On time or early — green
    return (
      <span className="text-[10px] font-mono font-medium bg-status-on-time-bg text-status-on-time border border-status-on-time-border px-1.5 py-0 rounded">
        {absDelay <= 1 ? "On time" : `${delay} min`}
      </span>
    );
  }

  // Delayed — severity-based colour: amber 2–14 min, red ≥15 min
  const severityClass =
    absDelay >= 15
      ? "bg-status-cancelled-bg text-status-cancelled border-status-cancelled-border"
      : "bg-status-delayed-bg text-status-delayed border-status-delayed-border";

  return (
    <span
      className={`text-[10px] font-mono font-medium border px-1.5 py-0 rounded ${severityClass}`}
    >
      +{delay} min
    </span>
  );
}

/** Loading tier: 0-30% = low, 31-70% = moderate, 71-100% = busy */
type LoadingTier = "low" | "moderate" | "busy";

function getLoadingTier(percentage: number): LoadingTier {
  return percentage <= 30 ? "low" : percentage <= 70 ? "moderate" : "busy";
}

/** Thin loading bar showing train occupancy at this stop */
function LoadingBar({ percentage }: { percentage: number | null }) {
  if (percentage === null) return null;

  const tier = getLoadingTier(percentage);
  const barClass = tier === "low"
    ? "bg-loading-low-bar"
    : tier === "moderate"
      ? "bg-loading-moderate-bar"
      : "bg-loading-busy-bar";
  const bgClass = tier === "low"
    ? "bg-loading-low-bg"
    : tier === "moderate"
      ? "bg-loading-moderate-bg"
      : "bg-loading-busy-bg";

  return (
    <div className={`h-1 rounded-full ${bgClass} w-full mt-1`}>
      <div
        className={`h-full rounded-full ${barClass} transition-all`}
        style={{ width: `${Math.max(percentage, 5)}%` }}
      />
    </div>
  );
}

/** Checkmark icon for visited stops */
function CheckIcon() {
  return (
    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  platSource,
  isCancelled,
  cancelReason,
  stopType,
  stopState,
  isLast,
  loadingPercentage,
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
  platSource: string | null;
  isCancelled: boolean;
  cancelReason: string | null;
  stopType: string;
  stopState: StopState;
  isLast: boolean;
  loadingPercentage: number | null;
}) {
  const displayName = normaliseStationName(name) || crs || "Unknown";
  const displayCrs = crs || "";

  const isCurrent = stopState === "current";
  const isPast = stopState === "past";
  const visited = isPast && (!!atdPushport || (ataPushport && stopType === "DT"));

  // Determine which times to show: prefer departure times, fall back to arrival
  const hasDeparture =
    ptdTimetable !== null || etdPushport !== null || atdPushport !== null;
  const scheduled = formatDisplayTime(hasDeparture ? ptdTimetable : ptaTimetable);
  const estimated = formatDisplayTime(hasDeparture ? etdPushport : etaPushport);
  const actual = formatDisplayTime(hasDeparture ? atdPushport : ataPushport);

  const delay = computeDelay(
    hasDeparture ? ptdTimetable : ptaTimetable,
    estimated,
    actual,
  );

  // Dot styling using semantic tokens
  const dotClass = isCancelled
    ? "border-status-cancelled-border bg-status-cancelled-bg"
    : visited
      ? "border-call-past-dot-border bg-call-past-dot-bg"
      : isPast
        ? "border-call-past-dot-border/60 bg-call-past-dot-bg/30"
        : isCurrent
          ? "border-call-current-dot-border bg-call-current-dot-bg"
          : "border-call-future-dot-border bg-call-future-dot-bg";

  // Connector line styling
  const lineClass = isPast ? "bg-timeline-past" : "bg-timeline-future";

  // Station name styling — delay-aware colours for past/current stops
  const absDelay = delay !== null ? Math.abs(delay) : 0;
  const isLateByDelay = delay !== null && delay >= 2;
  const nameClass = isCancelled
    ? "line-through text-status-cancelled"
    : isCurrent
      ? isLateByDelay
        ? absDelay >= 15
          ? "text-status-cancelled"
          : "text-status-delayed"
        : "text-status-approaching"
      : isPast
        ? visited && isLateByDelay
          ? absDelay >= 15
            ? "text-status-cancelled"
            : "text-status-delayed"
          : visited
            ? "text-status-arrived"
            : "text-text-secondary"
        : "text-text-primary";

  return (
    <div className={`flex items-start gap-3 group ${isCurrent ? "relative" : ""}`}>
      {/* Timeline column */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center mt-1.5 shrink-0 ${dotClass}`}
        >
          {visited && !isCancelled && <CheckIcon />}
        </div>
        {!isLast && <div className={`w-0.5 flex-1 min-h-6 ${lineClass}`} />}
      </div>

      {/* Stop info */}
      <div className="flex-1 min-w-0 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${nameClass}`}>
            {displayName}
            {isCurrent && (
              <span className="ml-2 text-xs font-medium text-status-approaching uppercase tracking-wider">
                Next
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {(platTimetable || platPushport) && (
              <PlatformBadge
                platformTimetable={platTimetable}
                platformLive={platPushport}
                platformSource={
                  platSource === "confirmed" ||
                  platSource === "altered" ||
                  platSource === "suppressed" ||
                  platSource === "expected" ||
                  platSource === "scheduled"
                    ? platSource
                    : platPushport
                      ? "expected"
                      : "scheduled"
                }
                size="compact"
              />
            )}
            <span className="text-[11px] font-mono text-text-muted">{displayCrs}</span>
          </div>
        </div>

        {/* Time row with delay indication */}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {isCancelled && (
            <span className="text-xs text-status-cancelled font-medium">
              Cancelled{cancelReason ? `: ${cancelReason}` : ""}
            </span>
          )}

          {!isCancelled && (
            <>
              {actual && (
                <span className="text-xs font-mono font-medium text-status-arrived">
                  {actual}
                </span>
              )}

              {scheduled && (
                <span
                  className={`text-xs font-mono ${
                    actual
                      ? "text-text-muted line-through"
                      : estimated &&
                          estimated !== "On time" &&
                          scheduled !== estimated
                        ? "text-text-muted line-through"
                        : "text-text-secondary"
                  }`}
                >
                  {scheduled}
                </span>
              )}

              {estimated &&
                !actual &&
                (estimated === "On time" ? (
                  <span className="text-xs font-mono text-status-on-time">On time</span>
                ) : scheduled && estimated !== scheduled ? (
                  <span className="text-xs font-mono font-semibold text-status-delayed">
                    Exp {estimated}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-status-delayed">
                    {estimated}
                  </span>
                ))}

              {/* Delay badge — visual delay indication per stop */}
              <DelayBadge delay={delay} />

              {actual && (
                <span className="text-[10px] text-status-arrived/80">
                  {atdPushport ? "Departed" : "Arrived"}
                </span>
              )}
            </>
          )}
        </div>

        {/* Loading indicator — train occupancy bar */}
        <LoadingBar percentage={loadingPercentage} />
      </div>
    </div>
  );
}

export function CallingPoints({ points, currentCrs }: CallingPointsProps) {
  // Only passenger stop types: IP (intermediate), OR (origin), DT (terminus).
  // Exclude all non-passenger: PP (passing point), OPOR (operational origin),
  // OPIP (operational intermediate), OPDT (operational destination), RM (reversing movement),
  // and any phantom stops with no CRS AND no public times.
  const NON_PASSENGER_STOP_TYPES = new Set([
    "PP",
    "OPOR",
    "OPIP",
    "OPDT",
    "RM",
  ]);

  const displayPoints = points.filter((cp) => {
    // Exclude non-passenger stop types
    if (NON_PASSENGER_STOP_TYPES.has(cp.stopType)) return false;
    // Exclude phantom stops: no CRS and no public timetable times
    if (!cp.crs && !cp.ptaTimetable && !cp.ptdTimetable) return false;
    return true;
  });

  if (displayPoints.length === 0) {
    return (
      <div className="text-xs text-text-muted italic py-2">
        No calling point data available
      </div>
    );
  }

  const normalisedTimes = normaliseCallingPointTimes(displayPoints);

  const rawNowMinutes = getUkNowMinutes();
  const nowMinutes = normaliseNowMinutes(rawNowMinutes, normalisedTimes[0]);

  let firstUpcomingIndex = -1;
  for (let i = 0; i < displayPoints.length; i++) {
    const cp = displayPoints[i];
    if (cp.atdPushport) continue;
    if (cp.ataPushport && cp.stopType === "DT") continue;
    if (cp.ataPushport || normalisedTimes[i] > nowMinutes) {
      firstUpcomingIndex = i;
      break;
    }
  }

  const currentStationIndex = currentCrs
    ? displayPoints.findIndex((cp) => cp.crs === currentCrs)
    : -1;

  return (
    <div className="py-2 px-1">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2 font-semibold">
        Calling Points
      </div>
      {displayPoints.map((cp, i) => {
        const isFirstUpcoming = i === firstUpcomingIndex;

        const stopState = determineStopState(
          cp.ataPushport,
          cp.atdPushport,
          normalisedTimes[i],
          isFirstUpcoming,
          nowMinutes,
        );

        const finalState: StopState =
          i === currentStationIndex && stopState === "future" ? "current" : stopState;

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
            platSource={cp.platSource}
            isCancelled={cp.isCancelled}
            cancelReason={cp.cancelReason ?? null}
            stopType={cp.stopType}
            stopState={finalState}
            isLast={i === displayPoints.length - 1}
            loadingPercentage={cp.loadingPercentage ?? null}
          />
        );
      })}
    </div>
  );
}