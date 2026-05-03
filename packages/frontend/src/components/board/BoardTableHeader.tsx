/**
 * BoardTableHeader — Column header row for the board grid
 *
 * Grid order matches ServiceRow: Time | Platform | Destination | Chevron
 * Same 4 columns at all breakpoints. Visible on all screen sizes.
 */

import { BOARD_GRID_COLS, BOARD_GRID_GAP, BOARD_GRID_PAD } from "./boardGrid";

export function BoardTableHeader() {
  return (
    <div
      className={`
        grid items-center ${BOARD_GRID_GAP} ${BOARD_GRID_PAD}
        text-xs font-medium uppercase tracking-wider
        border-b
        text-text-secondary bg-surface-page border-border-default
        ${BOARD_GRID_COLS}
      `}
    >
      <div className="text-left">Time</div>
      <div className="text-center">Platform</div>
      <div className="min-w-0 text-left">Destination</div>
      <div />
    </div>
  );
}