/**
 * Array utilities for Darwin data processing
 * Darwin sometimes sends single objects instead of arrays.
 */

/** Ensure a value is an array (Darwin sometimes sends single objects). */
export function toArray<T>(v: T | T[] | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) return [v];
  return [];
}