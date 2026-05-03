/**
 * Shared grid configuration for the departure/arrival board.
 *
 * Used by both DepartureBoard (header row) and ServiceRow (data rows)
 * to guarantee column alignment at every breakpoint.
 *
 * Grid order: Time | Platform | Destination | Chevron
 * Same 4 columns at all breakpoints — only widths increase.
 */

/** Grid column template classes — must appear as full strings for Tailwind scanning */
export const BOARD_GRID_COLS =
  "grid-cols-[3.5rem_auto_1fr_1rem] sm:grid-cols-[4.5rem_4.5rem_1fr_1rem]";

/** Gap between grid columns/rows */
export const BOARD_GRID_GAP = "gap-x-3 gap-y-1";

/** Padding inside each grid row */
export const BOARD_GRID_PAD = "px-3 py-2.5";