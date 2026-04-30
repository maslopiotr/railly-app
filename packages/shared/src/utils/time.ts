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
