/**
 * TimePicker — Hourly time-of-day selector
 *
 * - <input type="time"> defaults to current full hour
 * - Snaps to full hours (17:00, 18:00, not 17:30)
 * - ±60min stepper buttons
 * - "Now" button to reset
 * - No preset chips — just type or step
 */

import { useCallback } from "react";

interface TimePickerProps {
  value: string | null;
  onChange: (time: string | null) => void;
  /** Compact mode for inline board header use */
  compact?: boolean;
  className?: string;
}

/** Get current hour as "HH:00" */
function currentHour(): string {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  return `${hh}:00`;
}

/** Snap a "HH:MM" string to the nearest full hour */
function snapToHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const roundedHour = m >= 30 ? (h + 1) % 24 : h;
  const hh = roundedHour.toString().padStart(2, "0");
  return `${hh}:00`;
}

/** Add/subtract minutes from a "HH:MM" time, wrapping at midnight */
function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(":").map(Number);
  let total = h * 60 + m + delta;
  total = ((total % 1440) + 1440) % 1440; // wrap 0–1439
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:00`;
}

export function TimePicker({ value, onChange, compact = false, className = "" }: TimePickerProps) {
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (!raw) {
        onChange(null);
        return;
      }
      onChange(snapToHour(raw));
    },
    [onChange]
  );

  const handleStep = useCallback(
    (delta: number) => {
      const base = value || currentHour();
      onChange(addMinutes(base, delta));
    },
    [value, onChange]
  );


  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={() => handleStep(-60)}
        className={`time-stepper ${compact ? "compact" : ""}`}
        aria-label="1 hour earlier"
        title="1 hour earlier"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="relative">
        <input
          type="time"
          value={value || ""}
          onChange={handleInputChange}
          className={`time-input ${compact ? "compact" : ""}`}
          aria-label="Select time"
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-slate-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>

      <button
        onClick={() => handleStep(60)}
        className={`time-stepper ${compact ? "compact" : ""}`}
        aria-label="1 hour later"
        title="1 hour later"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {value && (
        <button
          onClick={() => onChange(null)}
          className={`time-now-btn ${compact ? "compact" : ""}`}
          aria-label="Reset to now"
          title="Reset to now"
        >
          Now
        </button>
      )}
    </div>
  );
}