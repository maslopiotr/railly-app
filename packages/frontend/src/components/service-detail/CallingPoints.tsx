/**
 * CallingPoints — Calling pattern for a hybrid service
 *
 * Two-column layout: TIME | DOT + STATION + PLATFORM + CRS
 *
 * Stop states & colours:
 * - Past (on time ≤1 min): ✓ green dot, green time
 * - Past (delayed 2–14): ✓ green dot, amber time + delay pill
 * - Past (delayed 15+): ✓ green dot, red time + delay pill
 * - Current station: ◉ amber dot with pulse, row highlight, delay pill
 * - Future: ○ hollow grey dot, secondary time
 * - Future delayed 2–14: ○ hollow grey dot, amber time + delay pill
 * - Future delayed 15+: ○ hollow grey dot, red time + delay pill
 * - Cancelled: ✕ red dot, strikethrough name, cancel reason
 *
 * Uses semantic design tokens only — no raw Tailwind colour classes.
 */

import type { ReactNode } from "react";
import type { HybridCallingPoint } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime, computeDelay } from "@railly-app/shared";
import { PlatformBadge } from "../shared/PlatformBadge";

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
  isBoardStationNotDeparted: boolean,
): StopState {
  if (atdPushport) return "past";
  if (ataPushport && !isFirstUpcoming) return "past";
  // Board station that hasn't departed is always current, even if scheduled time has passed
  if (isFirstUpcoming && isBoardStationNotDeparted) return "current";
  if (normalisedTime <= nowMinutes) return "past";
  if (isFirstUpcoming) return "current";
  return "future";
}

/**
 * Delay pill for any stop row.
 * Coloured pill: amber for 2–14 min delay, red for ≥15 min.
 */
function DelayPill({ delay }: { delay: number | null }) {
  if (delay === null || delay <= 1) return null;
  const absDelay = Math.abs(delay);
  const severityClass =
    absDelay >= 15
      ? "bg-status-cancelled-bg text-status-cancelled border-status-cancelled-border"
      : "bg-status-delayed-bg text-status-delayed border-status-delayed-border";

  return (
    <span
      className={`text-xs font-mono font-medium border px-1.5 py-0 rounded ${severityClass}`}
    >
      +{delay} min
    </span>
  );
}

/** Thin loading bar showing train occupancy at this stop */
function LoadingBar({ percentage }: { percentage: number | null }) {
  if (percentage === null) return null;

  const tier = percentage <= 30 ? "low" : percentage <= 70 ? "moderate" : "busy";
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

/** Checkmark icon for past stops */
function CheckIcon() {
  return (
    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** X icon for cancelled stops */
function XIcon() {
  return (
    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** Get delay severity colour class for time text */
function getDelayTimeClass(delay: number | null, isCurrent: boolean): string {
  if (delay === null) return "text-text-secondary";
  const abs = Math.abs(delay);
  if (abs >= 15) return "text-status-cancelled";
  if (abs >= 2) return "text-status-delayed";
  return isCurrent ? "text-status-on-time" : "text-status-on-time";
}

/** Individual calling point row — two-column layout */
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
  etaDelayed,
  etdDelayed,
  cancelReason,
  delayReason,
  stopType,
  stopState,
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
  etaDelayed: boolean;
  etdDelayed: boolean;
  cancelReason: string | null;
  delayReason: string | null;
  stopType: string;
  stopState: StopState;
  loadingPercentage: number | null;
}) {
  const displayName = normaliseStationName(name) || crs || "Unknown";

  const isCurrent = stopState === "current";
  const isPast = stopState === "past";
  const visited = isPast && (!!atdPushport || (ataPushport && stopType === "DT"));

  // Determine which times to show: prefer departure times, fall back to arrival
  const hasDeparture =
    ptdTimetable !== null || etdPushport !== null || atdPushport !== null;
  const scheduled = formatDisplayTime(hasDeparture ? ptdTimetable : ptaTimetable);
  const rawEstimate = hasDeparture ? etdPushport : etaPushport;
  const isDelayed = hasDeparture ? etdDelayed : etaDelayed;
  // When Darwin flags delayed with no estimate, show "Delayed" text
  const estimated = formatDisplayTime(rawEstimate)
    ?? (isDelayed ? "Delayed" : null);
  const actual = formatDisplayTime(hasDeparture ? atdPushport : ataPushport);

  const delay = computeDelay(
    hasDeparture ? ptdTimetable : ptaTimetable,
    estimated,
    actual,
  );

  // ── Dot styling ──
  const dotClass = isCancelled
    ? "border-status-cancelled-border bg-status-cancelled-bg"
    : visited
      ? "border-call-past-dot-border bg-call-past-dot-bg"
      : isPast
        ? "border-call-past-dot-border/60 bg-call-past-dot-bg/30"
        : isCurrent
          ? "border-call-current-dot-border bg-call-current-dot-bg"
          : "border-call-future-dot-border bg-call-future-dot-bg";

  // ── Time text content and colour ──
  let timeContent: ReactNode = null;
  let timeClass = "text-text-secondary font-mono text-sm";

  if (isCancelled) {
    timeContent = null;
    timeClass = "";
  } else if (actual) {
    timeClass = `font-mono text-sm font-semibold ${getDelayTimeClass(delay, isCurrent)}`;
    timeContent = actual;
  } else if (estimated) {
    if (estimated === "Delayed") {
      // Darwin confirmed delay but gave no time estimate — show "Delayed" in status colour
      timeClass = `text-sm font-semibold text-status-delayed`;
      timeContent = "Delayed";
    } else if (estimated === "On time") {
      if (isCurrent) {
        timeClass = "text-sm font-semibold text-status-on-time";
        timeContent = "On time";
      } else {
        timeClass = "text-sm font-mono text-status-on-time";
        timeContent = scheduled;
      }
    } else if (scheduled && estimated !== scheduled) {
      timeClass = `font-mono text-sm ${isCurrent ? "font-semibold" : ""} ${getDelayTimeClass(delay, isCurrent)}`;
      timeContent = estimated;
    } else {
      timeClass = `font-mono text-sm ${isCurrent ? "font-semibold" : ""} text-text-secondary`;
      timeContent = estimated;
    }
  } else if (scheduled) {
    timeClass = "font-mono text-sm text-text-secondary";
    timeContent = scheduled;
  }

  // ── Station name styling ──
  const nameClass = isCancelled
    ? "line-through text-status-cancelled"
    : isCurrent
      ? "text-text-primary font-medium"
      : isPast
        ? "text-text-secondary"
        : "text-text-primary";

  // ── Per-stop delay pill: show for any stop with delay ≥ 2 ──
  const showDelayPill = !isCancelled && delay !== null && delay >= 2;

  return (
    <div
      className={`flex items-center ${isCurrent ? "border-l-2 border-call-current-dot-border bg-call-current-dot-bg/10 -mx-0.5 pl-0.5 rounded-r" : ""}`}
    >
      {/* Column 1: Time */}
      <div className="w-18 shrink-0 text-right pr-2 py-1.5">
        {timeContent !== null && (
          <span className={timeClass}>{timeContent}</span>
        )}
        {/* Delay pill */}
        {showDelayPill && (
          <div className="mt-0.5">
            <DelayPill delay={delay} />
          </div>
        )}
      </div>

      {/* Column 2: Dot + Station + Platform + CRS */}
      <div className="flex items-center gap-2 flex-1 min-w-0 py-1.5">
        {/* Dot */}
        <div
          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${dotClass} ${isCurrent && !isCancelled ? "animate-pulse-subtle" : ""}`}
        >
          {isCancelled && <XIcon />}
          {visited && !isCancelled && <CheckIcon />}
          {isCurrent && !isCancelled && !visited && (
            <div className="w-1.5 h-1.5 rounded-full bg-call-current-dot-border" />
          )}
        </div>

        {/* Station details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${nameClass}`}>
              {displayName}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {(platTimetable || platPushport) && !isCancelled && (
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
              {crs && (
                <span className="text-[11px] font-mono text-text-muted">{crs}</span>
              )}
            </div>
          </div>

          {/* Cancelled reason text */}
          {isCancelled && (
            <div className="mt-0.5">
              <span className="text-xs font-medium text-status-cancelled">Cancelled</span>
              {cancelReason && (
                <span className="text-xs text-text-muted ml-1">— {cancelReason}</span>
              )}
            </div>
          )}

          {/* Per-stop delay reason */}
          {!isCancelled && delayReason && delay !== null && delay >= 2 && (
            <div className="mt-0.5 text-xs text-text-muted">
              {delayReason}
            </div>
          )}

          {/* Loading bar — train occupancy at this stop */}
          {!isCancelled && loadingPercentage !== null && (
            <LoadingBar percentage={loadingPercentage} />
          )}
        </div>
      </div>
    </div>
  );
}

export function CallingPoints({ points, currentCrs }: CallingPointsProps) {
  // Only passenger stop types: IP (intermediate), OR (origin), DT (terminus).
  const NON_PASSENGER_STOP_TYPES = new Set([
    "PP",
    "OPOR",
    "OPIP",
    "OPDT",
    "RM",
  ]);

  const displayPoints = points.filter((cp) => {
    if (NON_PASSENGER_STOP_TYPES.has(cp.stopType)) return false;
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

  const currentStationIndex = currentCrs
    ? displayPoints.findIndex((cp) => cp.crs === currentCrs)
    : -1;

  // If the board station hasn't departed yet, it's the current stop regardless
  // of whether its scheduled time has passed.
  const boardStationNotDeparted =
    currentStationIndex >= 0 && !displayPoints[currentStationIndex].atdPushport;

  let firstUpcomingIndex = -1;
  for (let i = 0; i < displayPoints.length; i++) {
    const cp = displayPoints[i];
    if (cp.atdPushport) continue;
    if (cp.ataPushport && cp.stopType === "DT") continue;
    if (
      cp.ataPushport ||
      normalisedTimes[i] > nowMinutes ||
      (boardStationNotDeparted && i === currentStationIndex)
    ) {
      firstUpcomingIndex = i;
      break;
    }
  }

  return (
    <div className="py-2 px-1">
      {displayPoints.map((cp, i) => {
        const isFirstUpcoming = i === firstUpcomingIndex;

        const stopState = determineStopState(
          cp.ataPushport,
          cp.atdPushport,
          normalisedTimes[i],
          isFirstUpcoming,
          nowMinutes,
          boardStationNotDeparted && i === currentStationIndex,
        );

        const finalState: StopState = stopState;

        return (
          <div key={`${cp.tpl}-${i}`}>
            <CallingPointRow
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
              etaDelayed={cp.etaDelayed ?? false}
              etdDelayed={cp.etdDelayed ?? false}
              cancelReason={cp.cancelReason ?? null}
              delayReason={cp.delayReason ?? null}
              stopType={cp.stopType}
              stopState={finalState}
              loadingPercentage={cp.loadingPercentage ?? null}
            />
          </div>
        );
      })}
    </div>
  );
}
