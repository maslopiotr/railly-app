/**
 * StationFilterBar — "From X → To Y" selector row for the board
 */

import { useState } from "react";
import type { StationSearchResult, HybridBoardResponse } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";
import { StationSearch } from "../shared/StationSearch";

interface StationFilterBarProps {
  station: StationSearchResult;
  board: HybridBoardResponse | null;
  destinationStation: StationSearchResult | null;
  onStationChange?: (station: StationSearchResult) => void;
  onDestinationChange: (dest: StationSearchResult | null) => void;
}

export function StationFilterBar({
  station,
  board,
  destinationStation,
  onStationChange,
  onDestinationChange,
}: StationFilterBarProps) {
  const [isFromStationEditing, setIsFromStationEditing] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b border-border-default bg-surface-card">
      {/* From */}
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0 w-10">From</span>
        {isFromStationEditing ? (
          <div className="flex-1 sm:w-[300px] shrink-0">
            <StationSearch
              onSelect={(s) => {
                setIsFromStationEditing(false);
                onStationChange?.(s);
              }}
              placeholder="Search for a station..."
              size="compact"
              autoFocus
            />
          </div>
        ) : (
          <div className="flex items-center gap-1 min-w-0 bg-surface-hover rounded px-2 py-1.5 flex-1 sm:w-[300px]">
            <span className="text-sm font-semibold text-text-primary truncate">
              {normaliseStationName(board?.stationName || station.name)}
            </span>
            <span className="text-[10px] font-mono text-text-muted shrink-0">
              {station.crsCode}
            </span>
            {onStationChange && (
              <button
                onClick={() => setIsFromStationEditing(true)}
                className="text-text-muted hover:text-status-cancelled text-xs px-1 shrink-0 focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
                aria-label={`Change station from ${normaliseStationName(station.name)}`}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* To / Going to */}
      <div className="flex items-center gap-2 w-full sm:w-auto flex-1 sm:flex-none">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0 w-10">To</span>
        {destinationStation ? (
          <div className="flex items-center gap-1 min-w-0 bg-surface-hover rounded px-2 py-1.5 flex-1 sm:w-[300px]">
            <span className="text-sm font-semibold text-text-primary truncate">
              {normaliseStationName(destinationStation.name)}
            </span>
            <span className="text-[10px] font-mono text-text-muted shrink-0">
              {destinationStation.crsCode}
            </span>
            <button
              onClick={() => onDestinationChange(null)}
              className="text-text-muted hover:text-status-cancelled text-xs px-1 shrink-0 focus-visible:ring-1 focus-visible:ring-blue-500 rounded"
              aria-label="Clear destination"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex-1 sm:w-[300px] shrink-0">
            <StationSearch
              onSelect={(s) => onDestinationChange(s)}
              placeholder="Any station…"
              size="compact"
            />
          </div>
        )}
      </div>
    </div>
  );
}