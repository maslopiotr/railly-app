/**
 * BoardPage — NR-style live departures/arrivals board page
 *
 * Thin presenter: delegates all state and logic to useBoard hook,
 * composes UI sub-components from components/board/.
 */

import { useBoard } from "../hooks/useBoard";
import { BoardHeader } from "../components/board/BoardHeader";
import { BoardTabs } from "../components/board/BoardTabs";
import { StationFilterBar } from "../components/board/StationFilterBar";
import { TimeNavigationBar } from "../components/board/TimeNavigationBar";
import { NrccMessages } from "../components/board/NrccMessages";
import { BoardTableHeader } from "../components/board/BoardTableHeader";
import { BoardServiceList } from "../components/board/BoardServiceList";
import type { HybridBoardService, StationSearchResult } from "@railly-app/shared";

const PULL_THRESHOLD = 60;

interface BoardPageProps {
  station: StationSearchResult;
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  onBack?: () => void;
  onStationChange?: (station: StationSearchResult) => void;
  onSelectService?: (service: HybridBoardService) => void;
  activeTab: "departures" | "arrivals";
  onTabChange: (tab: "departures" | "arrivals") => void;
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
  activeTab,
  onTabChange,
  destinationStation,
  onDestinationChange,
}: BoardPageProps) {
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

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-slide-up">
      <BoardHeader
        station={station}
        board={board}
        isFavourite={isFavourite}
        onToggleFavourite={onToggleFavourite}
        onBack={onBack}
      />

      <BoardTabs activeTab={activeTab} onTabChange={onTabChange} />

      {onDestinationChange && (
        <StationFilterBar
          station={station}
          board={board}
          destinationStation={destinationStation ?? null}
          onStationChange={onStationChange}
          onDestinationChange={onDestinationChange}
        />
      )}

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