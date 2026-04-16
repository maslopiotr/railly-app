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

/** Get current time as UK rail format (HHmm) */
export function getCurrentRailTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  return `${hours}${minutes}`;
}