/**
 * UK rail time formatting and computation utilities
 * UK rail times use HHmm format (e.g., "1430" for 14:30)
 *
 * All functions are pure and side-effect-free (except getUkNow which reads
 * the system clock). No runtime dependencies — only built-in Intl and Date APIs.
 */

/**
 * Format a rail time string for display.
 * Handles multiple input formats:
 * - "HHmm" (e.g. "0930" → "09:30")
 * - "HH:MM" (already formatted, returned as-is)
 * - "HH:MM:SS" (seconds stripped)
 * - "Half HH:MM" (strips "Half" prefix)
 * - null/undefined → null
 */
export function formatDisplayTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const cleaned = time.replace("Half", "").trim();
  if (cleaned.length === 4 && !cleaned.includes(":")) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
  }
  // Strip seconds: "HH:MM:SS" → "HH:MM"
  if (cleaned.length > 5 && cleaned.includes(":")) {
    return cleaned.substring(0, 5);
  }
  return cleaned;
}

/**
 * Parse a time string to minutes since midnight.
 *
 * Handles multiple input formats via formatDisplayTime:
 * - "HH:MM" (standard)
 * - "HH:MM:SS" (seconds stripped)
 * - "HHmm" (converted to HH:MM)
 * - "Half HH:MM" (prefix stripped)
 *
 * Returns null for invalid, unparseable, or out-of-range times.
 * Validates hours (0–23) and minutes (0–59).
 */
export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const formatted = formatDisplayTime(time);
  if (!formatted) return null;
  const parts = formatted.split(":").map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const hours = parts[0];
  const mins = parts[1];
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Compute delay in minutes between scheduled and estimated/actual time.
 * Handles midnight crossings (if difference >12h, wraps around).
 *
 * Returns:
 * - 0 for "On time"
 * - null for "Cancelled" (no meaningful delay for a cancelled service)
 * - null if data is insufficient
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

/**
 * Compute sort_time from timetable times — the natural key for ordering.
 * Uses timetable-only times (never pushport) because these are stable
 * and don't change with real-time updates.
 * Priority: wtd > ptd > wtp > wta > pta > '00:00' (fallback)
 * Truncates HH:MM:SS to HH:MM for consistency.
 */
export function computeSortTime(pt: {
  wtd?: string | null | undefined;
  ptd?: string | null | undefined;
  wtp?: string | null | undefined;
  wta?: string | null | undefined;
  pta?: string | null | undefined;
}): string {
  const raw = pt.wtd || pt.ptd || pt.wtp || pt.wta || pt.pta;
  if (!raw) return "00:00";
  return raw.length > 5 ? raw.substring(0, 5) : raw;
}

/**
 * Get UK-local date string and minutes-since-midnight.
 * Uses Intl.DateTimeFormat with Europe/London timezone.
 * No runtime dependencies — only built-in APIs.
 */
export function getUkNow(): { dateStr: string; nowMinutes: number } {
  const now = new Date();
  const ukTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const dateParts = ukTime.split(", ")[0].split("/");
  const timePart = ukTime.split(", ")[1];
  const dateStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
  const [hours, minutes] = timePart.split(":").map(Number);
  return { dateStr, nowMinutes: hours * 60 + minutes };
}