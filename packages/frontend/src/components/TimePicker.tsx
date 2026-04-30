/**
 * TimePicker — Inline time selector with ◀ now ▶ reset pattern
 *
 * Four interactive elements in a single bar:
 * - ◀ arrow: shift time back 1 hour
 * - Centre label ("now" or "17:00"): opens popover for precise time selection
 * - ▶ arrow: shift time forward 1 hour
 * - "reset" button: always visible, resets to now
 *
 * No layout shift — all elements always present, popover opens below the label.
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside the entire component
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        isOpen &&
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleStep = useCallback(
    (delta: number) => {
      const base = value || currentTimeStr();
      // Snap to hour first if from "now"
      const hourBase = base.includes(":") ? `${base.split(":")[0]}:00` : base;
      onChange(addHours(hourBase, delta));
      // Keep popover open if already open, don't open if closed
    },
    [value, onChange]
  );

  const handleLabelClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

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

  const handleReset = useCallback(() => {
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  // Display label in the centre
  const label = isNow ? "now" : value;
  const displayTime = isNow ? currentTimeStr() : value;

  return (
    <div ref={wrapperRef} className={`time-picker-wrapper relative inline-flex flex-col items-center ${className}`}>
      {/* Bar group: ◀ label ▶ reset */}
      <div className="time-bar-group inline-flex">
        {/* Left arrow */}
        <button
          onClick={() => handleStep(-1)}
          className={`time-bar-arrow ${compact ? "compact" : ""}`}
          aria-label="1 hour earlier"
          title="1 hour earlier"
        >
          <svg className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Centre label — clickable to open popover */}
        <button
          onClick={handleLabelClick}
          className={`time-bar-label ${compact ? "compact" : ""} ${isOpen ? "active" : ""}`}
          aria-label={isNow ? "Change time" : `Selected time: ${value}`}
          title={isNow ? "Change time" : `Showing services at ${value}`}
        >
          {label}
        </button>

        {/* Right arrow */}
        <button
          onClick={() => handleStep(1)}
          className={`time-bar-arrow ${compact ? "compact" : ""}`}
          aria-label="1 hour later"
          title="1 hour later"
        >
          <svg className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Reset button — always visible, resets to now */}
        <button
          onClick={handleReset}
          className={`time-bar-reset ${compact ? "compact" : ""} ${isNow ? "dimmed" : ""}`}
          aria-label="Reset to now"
          title="Reset to now"
          disabled={isNow}
        >
          reset
        </button>
      </div>

      {/* Popover for precise time selection */}
      {isOpen && (
        <div
          className="time-bar-popover"
        >
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={displayTime || ""}
              onChange={handleInputChange}
              className="time-input"
              aria-label="Select time"
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}