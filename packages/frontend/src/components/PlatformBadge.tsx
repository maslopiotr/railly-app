/**
 * PlatformBadge — Shared platform indicator for board rows and service detail
 *
 * Shows platform number with visual distinction based on source confidence:
 * - Confirmed: solid blue (platform confirmed by train describer)
 * - Altered: amber with booked→live transition
 * - Suppressed: dashed amber border with ✱ indicator
 * - Expected: dashed grey border (platform expected but not confirmed)
 * - Scheduled: solid grey border (from timetable only)
 *
 * Uses semantic design tokens only — no raw Tailwind colour classes.
 */

import type { PlatformSource } from "@railly-app/shared";

interface PlatformBadgeProps {
  platformTimetable: string | null;
  platformLive: string | null;
  platformSource: PlatformSource;
  /** Size variant: "default" for board rows, "large" for service detail header, "compact" for calling points */
  size?: "default" | "large" | "compact";
}

export function PlatformBadge({
  platformTimetable,
  platformLive,
  platformSource,
  size = "default",
}: PlatformBadgeProps) {
  const sizeClasses =
    size === "large"
      ? "px-3 py-1 text-sm min-w-[3rem]"
      : size === "compact"
        ? "px-1 py-0 text-[11px]"
        : "px-2 py-0.5 text-xs min-w-[2.5rem] sm:min-w-[2.75rem] sm:py-1 sm:text-sm";

  if (!platformTimetable && !platformLive) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded text-xs font-bold font-mono bg-surface-hover text-text-muted ${sizeClasses}`}
      >
        —
      </span>
    );
  }

  switch (platformSource) {
    case "confirmed":
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-platform-confirmed-bg text-platform-confirmed-text ${sizeClasses}`}
        >
          {platformLive || platformTimetable}
        </span>
      );

    case "altered":
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-platform-altered-bg text-platform-altered-text gap-0.5 ${sizeClasses}`}
        >
          <span className="line-through opacity-60">{platformTimetable}</span>
          <span className="text-[10px] opacity-80">→</span>
          <span className="font-bold">{platformLive}</span>
        </span>
      );

    case "suppressed":
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-platform-suppressed-bg text-platform-suppressed-text border relative ${sizeClasses}`}
          style={{ borderStyle: "dashed", borderColor: "var(--platform-suppressed-border)" }}
        >
          {platformLive}
          <span className="absolute -top-1.5 -right-1.5 text-[8px] text-status-delayed bg-status-delayed-bg rounded-full w-3 h-3 flex items-center justify-center">
            ✱
          </span>
        </span>
      );

    case "expected":
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-platform-expected-bg text-platform-expected-text ${sizeClasses}`}
          style={{ border: `1px dashed var(--platform-expected-border)` }}
        >
          —
        </span>
      );

    case "scheduled":
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-platform-scheduled-bg text-platform-scheduled-text border border-platform-scheduled-border ${sizeClasses}`}
        >
          {platformTimetable}
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center justify-center rounded font-bold font-mono bg-surface-hover text-text-secondary ${sizeClasses}`}
        >
          {platformLive || platformTimetable}
        </span>
      );
  }
}