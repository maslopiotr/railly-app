/**
 * BoardHeader — Station name, CRS badge, back button, and favourite toggle
 */

import type { StationSearchResult, HybridBoardResponse } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";

interface BoardHeaderProps {
  station: StationSearchResult;
  board: HybridBoardResponse | null;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onBack?: () => void;
}

export function BoardHeader({
  station,
  board,
  isFavourite,
  onToggleFavourite,
  onBack,
}: BoardHeaderProps) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center px-4 py-3 gap-3">
      {/* Left: Back button */}
      <div>
        {onBack && (
          <button
            className="text-sm select-none text-text-secondary hover:text-text-primary py-1 px-2 min-h-11 flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 rounded gap-1"
            onClick={onBack}
            aria-label="Go back to home"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
      </div>

      {/* Centre: Station name + CRS + favourite */}
      <div className="flex items-center justify-center gap-2 min-w-0">
        <h2 className="text-lg font-bold flex items-center gap-2 text-text-primary truncate">
          {normaliseStationName(board?.stationName || station.name)}
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary">
            {station.crsCode}
          </span>
        </h2>
        {onToggleFavourite && (
          <button
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-lg leading-none transition-all duration-200 cursor-pointer select-none hover:bg-surface-hover active:scale-90 focus-visible:ring-2 focus-visible:ring-blue-500 ${isFavourite ? "text-favourite" : "text-text-muted hover:text-favourite"}`}
            onClick={onToggleFavourite}
            aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            title={isFavourite ? "Remove from favourites" : "Add to favourites"}
            style={isFavourite ? { animation: "favouritePop 300ms ease-out" } : undefined}
          >
            {isFavourite ? "★" : "☆"}
          </button>
        )}
      </div>
    </div>
  );
}