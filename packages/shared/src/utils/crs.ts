/**
 * CRS (Computer Reservation System) code helpers
 * UK railway station codes are 3-letter alpha codes
 */

/** Validate a CRS code (3 uppercase letters) */
export function isValidCrsCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** Normalize a CRS code to uppercase */
export function normalizeCrsCode(code: string): string {
  return code.toUpperCase().trim();
}