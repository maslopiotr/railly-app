/**
 * CRS (Computer Reservation System) code helpers
 * UK railway station codes are 3-letter alpha codes
 */

/** Normalize a CRS code to uppercase */
export function normalizeCrsCode(code: string): string {
  return code.toUpperCase().trim();
}