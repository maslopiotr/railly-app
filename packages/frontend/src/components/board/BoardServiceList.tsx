/**
 * BoardServiceList — Service rows, pull-to-refresh, loading skeletons,
 * empty state, and load-more button for the board.
 */

import type { HybridBoardService, HybridBoardResponse, StationSearchResult } from "@railly-app/shared";
import { ServiceRow } from "./ServiceRow";
import { computeDurationMinutes, countStops, formatDuration } from "../../utils/service";

interface BoardServiceListProps {
  isLoading: boolean;
  board: HybridBoardResponse | null;
  error: string | null;
  displayServices: HybridBoardService[];
  activeTab: "departures" | "arrivals";
  station: StationSearchResult;
  destinationFilter: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  pullDistance: number;
  pullOpacity: number;
  onSelectService?: (service: HybridBoardService) => void;
  onDestinationChange?: (dest: StationSearchResult | null) => void;
  onLoadMore: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  PULL_THRESHOLD: number;
}

export function BoardServiceList({
  isLoading,
  board,
  error,
  displayServices,
  activeTab,
  station,
  destinationFilter,
  hasMore,
  isLoadingMore,
  isRefreshing,
  pullDistance,
  pullOpacity,
  onSelectService,
  onDestinationChange,
  onLoadMore,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  listRef,
  PULL_THRESHOLD,
}: BoardServiceListProps) {
  return (
    <>
      {/* ─── Pull-to-refresh indicator ─── */}
      <div
        className="text-center overflow-hidden select-none transition-all duration-200 h-(--pull-distance) opacity-(--pull-opacity)"
        style={
          {
            "--pull-distance": `${pullDistance}px`,
            "--pull-opacity": pullOpacity,
          } as React.CSSProperties
        }
        aria-live="polite"
      >
        {isRefreshing ? (
          <div className="flex items-center justify-center py-2 text-sm text-text-muted">
            <div className="w-4 h-4 border-2 border-border-emphasis border-t-transparent rounded-full animate-spin mr-2" />
            Refreshing…
          </div>
        ) : (
          <div className="flex items-center justify-center py-2 text-sm text-text-muted">
            {pullDistance >= PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </div>
        )}
      </div>

      {/* ─── Service list ─── */}
      <div
        className="px-2 sm:px-3 max-h-[70vh] overflow-y-auto"
        ref={listRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {isLoading && !board && (
          <div className="text-center py-8 text-text-muted animate-pulse-subtle">
            <div className="flex flex-col gap-3 px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-surface-hover rounded-lg" />
              ))}
            </div>
          </div>
        )}
        {error && <div className="text-center py-4 text-status-cancelled">{error}</div>}
        {!isLoading && !error && displayServices.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="font-medium text-text-secondary">
              No {activeTab === "departures" ? "departures" : "arrivals"} found
            </p>
            <p className="text-sm text-text-muted mt-1">
              {destinationFilter
                ? "Try changing the destination filter"
                : "Try the other tab or check back later"}
            </p>
            {destinationFilter && onDestinationChange && (
              <button
                onClick={() => onDestinationChange(null)}
                className="mt-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
              >
                Clear destination filter
              </button>
            )}
          </div>
        )}
        <div className="animate-stagger flex flex-col gap-2">
          {displayServices.map((service) => {
            const duration = computeDurationMinutes(service);
            const stops = countStops(service);
            const durationStr = formatDuration(duration);

            return (
              <ServiceRow
                key={service.rid}
                service={service}
                isArrival={activeTab === "arrivals"}
                stationCrs={station.crsCode}
                onSelect={onSelectService}
                subtitle={`${stops === 0 ? "Direct" : `${stops} stop${stops !== 1 ? "s" : ""}`}${durationStr ? ` · ${durationStr}` : ""}`}
              />
            );
          })}
        </div>

        {/* ─── Load more ─── */}
        {hasMore && !isLoading && (
          <div className="flex justify-center py-3">
            <button
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border-default bg-surface-card text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={onLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-border-emphasis border-t-transparent rounded-full animate-spin" />
                  Loading…
                </span>
              ) : (
                "Load more services"
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}