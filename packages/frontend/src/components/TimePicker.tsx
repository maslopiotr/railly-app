/**
 * TimePicker — Dropdown popover time selector
 *
 * Two modes:
 * - "Now" mode: Shows a "🕐 Now" pill button. Clicking opens a dropdown WITHOUT changing results.
 * - Custom time: Shows "🕐 17:00" pill with dropdown open showing steppers.
 *
 * No layout shift — the pill button has fixed width, dropdown opens below it.
 */

import { useState, useCallback, useEffect, useRef } from "react";

interface TimePickerProps {
  value: string | null;
  onChange: (time: string | null) => void;
  compact?: boolean;
  className?: string;
}

/** Format current time as "HH:MM" */
function currentTimeStr(): string {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Add/subtract hours from a "HH:MM" time, wrapping at midnight */
function addHours(time: string, delta: number): string {
  const [h] = time.split(":").map(Number);
  const newH = ((h + delta) % 24 + 24) % 24;
  return `${newH.toString().padStart(2, "0")}:00`;
}

export function TimePicker({ value, onChange, compact = false, className = "" }: TimePickerProps) {
  const isNow = value === null;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        pillRef.current &&
        !pillRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handlePillClick = useCallback(() => {
    if (isNow) {
      // Just open the dropdown, don't change the time
      setIsOpen(true);
    } else {
      // Toggle dropdown
      setIsOpen((prev) => !prev);
    }
  }, [isNow]);

  const handleStep = useCallback(
    (delta: number) => {
      const base = value || currentTimeStr();
      // Snap to hour first if from "now"
      const hourBase = base.includes(":") ? `${base.split(":")[0]}:00` : base;
      onChange(addHours(hourBase, delta));
    },
    [value, onChange]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (!raw) {
        onChange(null);
        return;
      }
      // Snap to hour
      const [h] = raw.split(":").map(Number);
      if (!isNaN(h)) {
        onChange(`${h.toString().padStart(2, "0")}:00`);
      }
    },
    [onChange]
  );

  const handleResetToNow = useCallback(() => {
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  // Display label on the pill
  const pillLabel = isNow ? "Now" : value;
  const displayTime = isNow ? currentTimeStr() : value;

  return (
    <div className={`time-picker-wrapper relative ${className}`}>
      <button
        ref={pillRef}
        onClick={handlePillClick}
        className={`time-now-toggle ${compact ? "compact" : ""}`}
        aria-label={isNow ? "Change time" : `Selected time: ${value}`}
        title={isNow ? "Change time" : `Showing services at ${value}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{pillLabel}</span>
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="time-picker-dropdown"
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStep(-1)}
              className="time-stepper"
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
                value={displayTime || ""}
                onChange={handleInputChange}
                className="time-input"
                aria-label="Select time"
              />
            </div>

            <button
              onClick={() => handleStep(1)}
              className="time-stepper"
              aria-label="1 hour later"
              title="1 hour later"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {!isNow && (
            <button
              onClick={handleResetToNow}
              className="time-dropdown-reset"
            >
              ← Back to now
            </button>
          )}
        </div>
      )}
    </div>
  );
}