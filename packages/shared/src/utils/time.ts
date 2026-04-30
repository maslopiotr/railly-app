/**
 * UK rail time formatting utilities
 * UK rail times use HHmm format (e.g., "1430" for 14:30)
 */

/** Format a UK rail time string (HHmm) to display format (HH:MM) */
export function formatRailTime(railTime: string): string {
  if (!railTime || railTime.length < 4) return railTime;
  const hours = railTime.slice(0, 2);
  const minutes = railTime.slice(2, 4);
  return `${hours}:${minutes}`;
}

/**
 * Format a rail time string for display.
 * Handles multiple input formats:
 * - "HHmm" (e.g. "0930" → "09:30")
 * - "HH:MM" (already formatted, returned as-is)
 * - "Half HH:MM" (strips "Half" prefix)
 * - null/undefined → null
 */
export function formatDisplayTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  return cleaned;
}

/** Get current time as UK rail format (HHmm) */
export function getCurrentRailTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  return `${hours}${minutes}`;
}

/** Parse HH:MM to minutes since midnight */
export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const formatted = formatDisplayTime(time);
  if (!formatted) return null;
  const [h, m] = formatted.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Compute delay in minutes between scheduled and estimated/actual time.
 * Handles midnight crossings (if difference >12h, wraps around).
 * Returns null if data is insufficient or the status is a non-numeric value.
 */
export function computeDelay(
  scheduled: string | null | undefined,
  estimated: string | null | undefined,
  actual: string | null | undefined,
): number | null {
  const ref = actual || estimated;
  if (!scheduled || !ref) return null;
  if (ref === "On time") return 0;
  if (ref === "Cancelled" || ref === "cancelled") return null;
  const schedMins = parseTimeToMinutes(scheduled);
  const refMins = parseTimeToMinutes(ref);
  if (schedMins === null || refMins === null) return null;
  let d = refMins - schedMins;
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;
  return d;
}
