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
 * Uses semantic design tokens and Tailwind utility classes only — no custom CSS.
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
      if (isOpen && wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
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
    },
    [value, onChange],
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
    [onChange],
  );

  const handleReset = useCallback(() => {
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  // Display label in the centre
  const label = isNow ? "now" : value;
  const displayTime = isNow ? currentTimeStr() : value;

  // Arrow button classes
  const arrowBaseClasses = compact
    ? "w-7 h-7"
    : "w-8 h-8";
  const arrowClasses = `${arrowBaseClasses} flex items-center justify-center border transition-all duration-150 cursor-pointer select-none bg-surface-hover border-border-default text-text-secondary hover:bg-border-default hover:text-text-primary hover:border-border-emphasis active:scale-90`;

  // Label button classes
  const labelBaseClasses = compact
    ? "px-2 py-1 text-xs"
    : "px-3 py-1.5 text-sm";
  const labelActiveClasses = isOpen
    ? "bg-surface-hover text-text-primary"
    : "bg-surface-page text-text-secondary hover:bg-surface-hover hover:text-text-primary";
  const labelClasses = `${labelBaseClasses} font-medium border-x transition-all duration-150 cursor-pointer select-none border-border-default ${labelActiveClasses}`;

  // Reset button classes
  const resetBaseClasses = compact
    ? "h-7 px-1.5 text-[10px]"
    : "px-2.5 h-8 text-xs";
  const resetClasses = `${resetBaseClasses} flex items-center justify-center border transition-all duration-150 cursor-pointer select-none rounded-r-lg font-medium bg-surface-hover border-border-default text-text-secondary hover:bg-border-default hover:text-text-primary hover:border-border-emphasis active:scale-95 ${isNow ? "opacity-40 pointer-events-none" : ""}`;

  // Icon size
  const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <div ref={wrapperRef} className={`relative inline-flex flex-col items-center ${className}`}>
      {/* Bar group: ◀ label ▶ reset */}
      <div className="inline-flex">
        {/* Left arrow */}
        <button
          onClick={() => handleStep(-1)}
          className={`${arrowClasses} rounded-l-lg focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:z-10`}
          aria-label="1 hour earlier"
          title="1 hour earlier"
        >
          <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Centre label — clickable to open popover */}
        <button
          onClick={handleLabelClick}
          className={`${labelClasses} focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:z-10`}
          aria-label={isNow ? "Change time" : `Selected time: ${value}`}
          title={isNow ? "Change time" : `Showing services at ${value}`}
        >
          {label}
        </button>

        {/* Right arrow */}
        <button
          onClick={() => handleStep(1)}
          className={`${arrowClasses} rounded-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:z-10`}
          aria-label="1 hour later"
          title="1 hour later"
        >
          <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Reset button — always visible, resets to now */}
        <button
          onClick={handleReset}
          className={`${resetClasses} focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:z-10`}
          aria-label="Reset to now"
          title="Reset to now"
          disabled={isNow}
        >
          reset
        </button>
      </div>

      {/* Popover for precise time selection */}
      {isOpen && (
        <div className="absolute top-full mt-1 p-3 rounded-lg border shadow-lg z-50 bg-surface-card border-border-default left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={displayTime || ""}
              onChange={handleInputChange}
              className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-mono cursor-pointer border transition-colors bg-surface-hover border-border-default text-text-primary hover:bg-border-default hover:border-border-emphasis focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              aria-label="Select time"
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}