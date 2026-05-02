/**
 * BoardTableHeader — Column header row for the board grid
 *
 * Grid order matches ServiceRow: Time | Platform | Status | Destination | [Calling at] | Chevron
 */

import { BOARD_GRID_COLS, BOARD_GRID_GAP, BOARD_GRID_PAD } from "./boardGrid";

export function BoardTableHeader() {
  return (
    <div
      className={`
        hidden sm:grid items-center ${BOARD_GRID_GAP} ${BOARD_GRID_PAD}
        text-xs font-medium uppercase tracking-wider
        border-b
        text-text-secondary bg-surface-page border-border-default
        ${BOARD_GRID_COLS}
      `}
    >
      <div className="text-right">Time</div>
      <div className="text-center">Plat</div>
      <div className="min-w-0">Status</div>
      <div className="min-w-0">Destination</div>
      <div className="hidden xl:block">Calling at</div>
      <div />
    </div>
  );
}