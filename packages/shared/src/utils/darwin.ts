/**
 * Darwin Push Port specific utilities
 * Helpers for processing Darwin RID and timestamp formats.
 */

/** Parse ISO timestamp string to epoch milliseconds for comparison. */
export function parseTs(ts: string): number {
  return new Date(ts).getTime();
}

/**
 * Derive SSD (Scheduled Start Date) from Darwin RID if not provided.
 * Darwin RID format: YYYYMMDDNNNNNNN (first 4 = year, next 2 = month, next 2 = day)
 */
export function deriveSsdFromRid(rid: string): string | null {
  if (rid.length >= 8) {
    const y = rid.slice(0, 4);
    const m = rid.slice(4, 6);
    const d = rid.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return null;
}