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
 * Supports light and dark mode via Tailwind utility classes.
 */

import type { PlatformSource } from "@railly-app/shared";

interface PlatformBadgeProps {
  platformTimetable: string | null;
  platformLive: string | null;
  platformSource: PlatformSource;
  /** Size variant: "default" for board rows, "large" for service detail header */
  size?: "default" | "large";
}

export function PlatformBadge({
  platformTimetable,
  platformLive,
  platformSource,
  size = "default",
}: PlatformBadgeProps) {
  const sizeClasses = size === "large" ? "text-lg px-3 py-1" : "";

  if (!platformTimetable && !platformLive) {
    return (
      <span className={`platform platform-none ${sizeClasses}`}>
        —
      </span>
    );
  }

  switch (platformSource) {
    case "confirmed":
      return (
        <span className={`platform platform-confirmed ${sizeClasses}`}>
          {platformLive || platformTimetable}
        </span>
      );

    case "altered":
      return (
        <span className={`platform platform-altered ${sizeClasses}`}>
          <span className="platform-booked">{platformTimetable}</span>
          <span className="platform-arrow">→</span>
          <span className="platform-live">{platformLive}</span>
        </span>
      );

    case "suppressed":
      return (
        <span className={`platform platform-suppressed ${sizeClasses}`}>
          {platformLive}
          <span className="suppressed-indicator">✱</span>
        </span>
      );

    case "expected":
      return (
        <span className={`platform platform-expected ${sizeClasses}`}>
          —
        </span>
      );

    case "scheduled":
      return (
        <span className={`platform platform-scheduled ${sizeClasses}`}>
          {platformTimetable}
        </span>
      );

    default:
      return (
        <span className={`platform ${sizeClasses}`}>
          {platformLive || platformTimetable}
        </span>
      );
  }
}