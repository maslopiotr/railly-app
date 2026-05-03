/**
 * ServiceRow — A single service row on the hybrid departure/arrival board
 *
 * Two-row card layout on all screen sizes:
 *   Row 1 (grid): Time | Platform | Destination | Chevron
 *   Row 2 (full-width): Status · Journey info · Operator · Coaches
 *
 * Same 4-column grid at all breakpoints — only column widths increase.
 * Colours use semantic design tokens only.
 * Status logic uses service.trainStatus from the backend as single source of truth.
 */

import type { HybridBoardService } from "@railly-app/shared";
import { normaliseStationName, formatDisplayTime } from "@railly-app/shared";
import { PlatformBadge } from "../shared/PlatformBadge";
import { BOARD_GRID_COLS, BOARD_GRID_GAP, BOARD_GRID_PAD } from "./boardGrid";

interface ServiceRowProps {
  service: HybridBoardService;
  isArrival?: boolean;
  onSelect?: (service: HybridBoardService) => void;
  /** Journey info text (e.g. "2 stops · 47m" or "Direct · 23m") */
  journeyText?: string;
}

/** Format time for display, falling back to "--:--" when null */
function displayTime(time: string | null | undefined): string {
  return formatDisplayTime(time) ?? "--:--";
}

export function ServiceRow({ service, isArrival, onSelect, journeyText }: ServiceRowProps) {
  const scheduledTime = isArrival ? service.sta : service.std;
  const estimatedTime = isArrival ? service.eta : service.etd;
  const actualTime = isArrival ? service.actualArrival : service.actualDeparture;
  const destination = isArrival ? service.origin : service.destination;

  const ts = service.trainStatus;
  const cancelled = ts === "cancelled";
  const isOnTime = ts === "on_time";
  const isDelayed = ts === "delayed";
  const isDeparted = ts === "departed";
  const isArrived = ts === "arrived";
  const isAtPlatform = ts === "at_platform";
  const isApproaching = ts === "approaching";

  const operatorText = service.tocName || service.toc || "";
  const mainName = normaliseStationName(destination?.name) || destination?.crs || "Unknown";

  // Time column text classes
  const timeClass = cancelled
    ? "text-status-cancelled line-through"
    : isDelayed
      ? "text-text-muted line-through"
      : "text-text-primary";

  // ── Build second row: status + journey context + operator + coaches ──
  const metaParts: { text: string; type: "status" | "time" | "info" | "operator" | "coaches" }[] = [];

  // 1. Status word + actual/estimated time combined
  if (cancelled) {
    metaParts.push({ text: "Cancelled", type: "status" });
  } else if (isDelayed) {
    const delayText = service.delayMinutes !== null && service.delayMinutes > 0
      ? `Delayed +${service.delayMinutes}m`
      : "Delayed";
    metaParts.push({ text: delayText, type: "status" });
  } else if (isDeparted) {
    metaParts.push({ text: "Departed", type: "status" });
  } else if (isArrived) {
    metaParts.push({ text: "Arrived", type: "status" });
  } else if (isAtPlatform) {
    metaParts.push({ text: "At platform", type: "status" });
  } else if (isApproaching) {
    metaParts.push({ text: "Approaching", type: "status" });
  } else if (isOnTime) {
    metaParts.push({ text: "On time", type: "status" });
  } else {
    metaParts.push({ text: "Scheduled", type: "status" });
  }

  // 2. Journey info
  if (journeyText) {
    metaParts.push({ text: journeyText, type: "info" });
  }

  // 3. Operator
  if (operatorText) {
    metaParts.push({ text: operatorText, type: "operator" });
  }

  // 4. Coaches
  if (service.length) {
    metaParts.push({ text: `${service.length} coach${service.length !== 1 ? "es" : ""}`, type: "coaches" });
  }

  // Status colour class
  const statusColourClass = cancelled
    ? "text-status-cancelled"
    : isDelayed
      ? "text-status-delayed"
      : isDeparted
        ? "text-status-arrived"
        : isArrived
          ? "text-status-arrived"
          : isAtPlatform
            ? "text-status-at-platform"
            : isApproaching
              ? "text-status-approaching"
              : isOnTime
                ? "text-status-on-time"
                : "text-text-muted";

  return (
    <div
      className={`${cancelled ? "opacity-60" : ""} cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-[--radius-card] transition-transform duration-100 active:scale-[0.97]`}
      onClick={() => onSelect?.(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect?.(service);
      }}
      aria-label={`${displayTime(scheduledTime)} to ${mainName}${cancelled ? " Cancelled" : ""}`}
    >
      <div
        className={`
          border rounded-[--radius-card]
          bg-surface-card border-border-default hover:bg-surface-hover
        `}
      >
        {/* Row 1: Grid — Time | Platform | Destination | Chevron */}
        <div
          className={`
            grid items-center ${BOARD_GRID_GAP} ${BOARD_GRID_PAD}
            ${BOARD_GRID_COLS}
            min-h-[32px]
          `}
        >
          {/* Column 1: Time — scheduled + actual/estimated below for visual status */}
          <div className="flex flex-col items-start justify-center">
            <span className={`text-sm font-mono font-semibold leading-tight ${timeClass}`}>
              {displayTime(scheduledTime)}
            </span>
            {isDelayed && estimatedTime ? (
              <span className="text-[11px] font-mono font-semibold leading-tight text-status-delayed">
                Exp {displayTime(estimatedTime)}
              </span>
            ) : (isDeparted || isArrived) && actualTime ? (
              <span className={`text-[11px] font-mono leading-tight ${
                service.delayMinutes !== null && Math.abs(service.delayMinutes) >= 15
                  ? "text-status-cancelled font-semibold"
                  : service.delayMinutes !== null && Math.abs(service.delayMinutes) >= 2
                    ? "text-status-delayed font-semibold"
                    : "text-status-arrived"
              }`}>
                {displayTime(actualTime)}
              </span>
            ) : null}
          </div>

          {/* Column 2: Platform */}
          <div className="flex justify-center">
            <PlatformBadge
              platformTimetable={service.platformTimetable}
              platformLive={service.platformLive}
              platformSource={service.platformSource}
            />
          </div>

          {/* Column 3: Destination */}
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{mainName}</div>
          </div>

          {/* Column 4: Chevron */}
          <span className="text-text-muted text-lg text-right">›</span>
        </div>

        {/* Row 2: Status · Journey info · Operator · Coaches */}
        <div className="px-3 pb-2 pt-0 flex items-center gap-1.5 flex-wrap">
          {metaParts.map((part, i) => (
            <span
              key={i}
              className={`text-xs leading-tight ${
                part.type === "status"
                  ? `font-semibold ${statusColourClass}`
                  : part.type === "time"
                    ? "font-semibold text-status-delayed"
                    : part.type === "info"
                      ? "text-text-secondary"
                      : part.type === "operator"
                        ? "text-text-secondary"
                        : "text-text-muted"
              }`}
            >
              {i > 0 && <span className="text-text-muted mx-0.5">·</span>}
              {part.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}