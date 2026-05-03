/**
 * BoardPage — NR-style live departures/arrivals board page
 *
 * Thin presenter: delegates all state and logic to useBoard hook,
 * composes UI sub-components from components/board/.
 */

import { useState } from "react";
import { useBoard } from "../hooks/useBoard";
import { BoardHeader } from "../components/board/BoardHeader";
import { BoardTabs } from "../components/board/BoardTabs";
import { StationFilterBar } from "../components/board/StationFilterBar";
import { TimeNavigationBar } from "../components/board/TimeNavigationBar";
import { NrccMessages } from "../components/board/NrccMessages";
import { BoardTableHeader } from "../components/board/BoardTableHeader";
import { BoardServiceList } from "../components/board/BoardServiceList";
import { normaliseStationName } from "@railly-app/shared";
import type { HybridBoardService, StationSearchResult } from "@railly-app/shared";

const PULL_THRESHOLD = 60;

interface BoardPageProps {
  station: StationSearchResult;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onBack?: () => void;
  onStationChange?: (station: StationSearchResult) => void;
  onSelectService?: (service: HybridBoardService) => void;
  destinationStation?: StationSearchResult | null;
  onDestinationChange?: (dest: StationSearchResult | null) => void;
}

export function BoardPage({
  station,
  isFavourite,
  onToggleFavourite,
  onBack,
  onStationChange,
  onSelectService,
  destinationStation,
  onDestinationChange,
}: BoardPageProps) {
  const [activeTab, setActiveTab] = useState<"departures" | "arrivals">("departures");
  const destinationFilter = destinationStation?.crsCode ?? null;

  const {
    board,
    isLoading,
    isLoadingMore,
    error,
    lastRefreshed,
    allServices,
    hasMore,
    relativeTime,
    displayTime,
    timeWindowOffset,
    pullDistance,
    isRefreshing,
    loadBoard,
    loadMore,
    handleEarlier,
    handleLater,
    handleNow,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    listRef,
  } = useBoard({
    crsCode: station.crsCode,
    boardType: activeTab,
    destinationFilter,
  });

  const pullOpacity = Math.min(pullDistance / PULL_THRESHOLD, 1);

  const fromName = normaliseStationName(board?.stationName || station.name);
  const toName = destinationStation
    ? normaliseStationName(destinationStation.name)
    : null;

  return (
    <div className="w-full max-w-4xl mx-auto animate-fade-slide-up">
      <BoardHeader
        station={station}
        board={board}
        onBack={onBack}
      />

      <BoardTabs activeTab={activeTab} onTabChange={setActiveTab} />
      
      <TimeNavigationBar
        timeWindowOffset={timeWindowOffset}
        displayTime={displayTime}
        isLoading={isLoading}
        relativeTime={relativeTime}
        lastRefreshed={lastRefreshed}
        onEarlier={handleEarlier}
        onLater={handleLater}
        onNow={handleNow}
        onRefresh={() => loadBoard()}
      />

      {onDestinationChange && (
        <StationFilterBar
          station={station}
          board={board}
          destinationStation={destinationStation ?? null}
          onStationChange={onStationChange}
          onDestinationChange={onDestinationChange}
        />
      )}

      {/* Favourite bar — saves the current journey */}
      {onToggleFavourite && (
        <div className="border-b border-border-default bg-surface-card mb-2">
          <button
            onClick={onToggleFavourite}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
              isFavourite
                ? "text-favourite hover:text-favourite/80"
                : "text-text-secondary hover:text-text-primary"
            }`}
            aria-label={
              isFavourite
                ? `Remove ${fromName}${toName ? ` to ${toName}` : ""} from favourites`
                : `Save ${fromName}${toName ? ` to ${toName}` : ""} to favourites`
            }
          >
            <span
              className={`text-base leading-none transition-transform duration-200 ${
                isFavourite ? "scale-110" : ""
              }`}
            >
              {isFavourite ? "★" : "☆"}
            </span>
            <span className="truncate">
              {isFavourite
                ? `Journey saved · tap to remove`
                : `Save ${fromName}${toName ? ` → ${toName}` : ""} to favourites`}
            </span>
          </button>
        </div>
      )}



      <NrccMessages messages={board?.nrccMessages ?? []} />

      <BoardTableHeader />

      <BoardServiceList
        isLoading={isLoading}
        board={board}
        error={error}
        displayServices={allServices}
        activeTab={activeTab}
        station={station}
        destinationFilter={destinationFilter}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        isRefreshing={isRefreshing}
        pullDistance={pullDistance}
        pullOpacity={pullOpacity}
        onSelectService={onSelectService}
        onDestinationChange={onDestinationChange}
        onLoadMore={loadMore}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        listRef={listRef}
        PULL_THRESHOLD={PULL_THRESHOLD}
      />
    </div>
  );
}