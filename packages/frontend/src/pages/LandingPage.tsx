/**
 * LandingPage — Home page with clock, search, journey favourites, and quick-access chips
 */

import { useState, useEffect, useCallback } from "react";
import type { StationSearchResult, TrainStatus } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";
import { StationSearch } from "../components/shared/StationSearch";
import { PlatformBadge } from "../components/shared/PlatformBadge";
import { fetchBoard } from "../api/boards";
import { POPULAR_STATIONS } from "../constants/stations";
import type { FavouriteJourney } from "../hooks/useFavourites";

const MOBILE_FAVOURITE_LIMIT = 3;

interface LandingPageProps {
  favourites: FavouriteJourney[];
  recentStations: StationSearchResult[];
  onStationSelect: (station: StationSearchResult, destination?: StationSearchResult | null) => void;
  onToggleFavourite?: (fromStation: StationSearchResult, toStation: StationSearchResult | null) => void;
}

// ── Live Clock ────────────────────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formattedTime = time.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <div className="text-3xl sm:text-4xl font-mono font-bold text-text-primary tracking-tight py-4">
      {formattedTime}
    </div>
  );
}

// ── Status Dot ─────────────────────────────────────────────────────────────

function statusDotColour(status: TrainStatus): string {
  switch (status) {
    case "on_time": return "bg-green-500";
    case "delayed": return "bg-amber-500";
    case "cancelled": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

// ── Station Chips (reused for Recent / Popular) ────────────────────────────

function StationChips({
  stations,
  onSelect,
  title,
  icon,
  variant,
}: {
  stations: StationSearchResult[];
  onSelect: (station: StationSearchResult, destination?: StationSearchResult | null) => void;
  title: string;
  icon?: React.ReactNode;
  variant?: "default" | "recent";
}) {
  if (stations.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {stations.map((station) => (
          <button
            key={station.crsCode}
            onClick={() => onSelect(station)}
            className={`transition-all duration-150 hover:scale-[1.03] active:scale-[0.97] px-3 py-1.5 border rounded-full text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary hover:border-border-emphasis flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 ${
              variant === "recent"
                ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                : "bg-surface-hover border-border-default"
            }`}
          >
            <span>{normaliseStationName(station.name)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Favourite Journey Card (compact) ───────────────────────────────────────

function FavouriteCard({
  journey,
  onSelect,
  onUnfavourite,
}: {
  journey: FavouriteJourney;
  onSelect: (station: StationSearchResult, destination: StationSearchResult | null) => void;
  onUnfavourite?: () => void;
}) {
  const [nextDeparture, setNextDeparture] = useState<{
    std: string;
    etd: string | null;
    status: TrainStatus;
    platformLive: string | null;
    platformTimetable: string | null;
    platformSource: string;
    platIsSuppressed: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchBoard(journey.from.crsCode, {
      destination: journey.to?.crsCode || undefined,
      type: "departures",
      limit: 3,
    })
      .then((data) => {
        if (cancelled) return;
        const s = data.services.find((svc) => svc.trainStatus !== "departed") ?? data.services[0];
        if (s) {
          setNextDeparture({
            std: s.std ?? "--:--",
            etd: s.etd,
            status: s.trainStatus,
            platformLive: s.platformLive,
            platformTimetable: s.platformTimetable,
            platformSource: s.platformSource ?? "scheduled",
            platIsSuppressed: s.platIsSuppressed ?? false,
          });
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [journey.from.crsCode, journey.to?.crsCode]);

  const fromName = normaliseStationName(journey.from.name);
  const toName = journey.to ? normaliseStationName(journey.to.name) : "Any station";

  return (
    <div
      className="relative flex flex-col gap-1 p-3 rounded-xl border border-border-default bg-surface-card hover:border-border-emphasis hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500"
      onClick={() => onSelect(journey.from, journey.to)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(journey.from, journey.to);
        }
      }}
      aria-label={`View departures from ${fromName}${journey.to ? ` to ${toName}` : ""}`}
    >
      {/* Row 1: From → To + unfavourite */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-semibold text-text-primary truncate">{fromName}</span>
        <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <span className="text-sm font-medium text-text-primary truncate flex-1">{toName}</span>
        {onUnfavourite && (
          <button
            className="w-5 h-5 flex items-center justify-center text-xs rounded-full transition-colors text-text-muted hover:text-status-cancelled hover:bg-surface-hover shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              onUnfavourite();
            }}
            aria-label={`Remove ${fromName}${journey.to ? ` to ${toName}` : ""} from favourites`}
            title="Remove from favourites"
          >
            ✕
          </button>
        )}
      </div>

      {/* Row 2: Departure time + status + platform */}
      <div className="flex items-center gap-2 min-h-5">
        {isLoading ? (
          <div className="w-16 h-3 bg-surface-hover rounded animate-pulse" />
        ) : nextDeparture ? (
          <>
            <span className="text-xs font-mono text-text-primary">
              {nextDeparture.etd && nextDeparture.etd !== "On time" ? nextDeparture.etd : nextDeparture.std}
            </span>
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColour(nextDeparture.status)}`} />
            {(nextDeparture.platformLive || nextDeparture.platformTimetable) && (
              <PlatformBadge
                platformTimetable={nextDeparture.platformTimetable}
                platformLive={nextDeparture.platformLive}
                platformSource={nextDeparture.platformSource as "confirmed" | "altered" | "suppressed" | "expected" | "scheduled"}
                size="compact"
              />
            )}
          </>
        ) : (
          <span className="text-[10px] text-text-muted">No services</span>
        )}
      </div>
    </div>
  );
}

// ── Landing Page ───────────────────────────────────────────────────────────

export function LandingPage({
  favourites,
  recentStations,
  onStationSelect,
  onToggleFavourite,
}: LandingPageProps) {
  const [landingDestination, setLandingDestination] = useState<StationSearchResult | null>(null);
  const [showAllFavourites, setShowAllFavourites] = useState(false);

  const handleFromSelect = useCallback(
    (station: StationSearchResult) => {
      onStationSelect(station, landingDestination);
    },
    [onStationSelect, landingDestination],
  );

  const visibleFavourites =
    !showAllFavourites && favourites.length > MOBILE_FAVOURITE_LIMIT
      ? favourites.slice(0, MOBILE_FAVOURITE_LIMIT)
      : favourites;

  const hiddenCount = favourites.length - MOBILE_FAVOURITE_LIMIT;

  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl sm:max-w-3xl">
      {/* Clock */}
      <div className="mb-6">
        <LiveClock />
      </div>

      {/* Tagline */}
      <h2 className="text-xl sm:text-2xl font-semibold text-center mb-2">
        Live UK Train Departures
      </h2>
      <p className="text-sm sm:text-base text-text-secondary text-center mb-8">
        Search any station to see departures, arrivals, and platform info
      </p>

      {/* Search */}
      <div className="w-full flex flex-col items-center mb-6">
        <div className="w-full sm:max-w-xl flex flex-col gap-3">
          {/* From */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0 w-10">From</span>
            <div className="flex-1">
              <StationSearch
                onSelect={handleFromSelect}
                placeholder="Enter a station name…"
                autoFocus
              />
            </div>
            <div className="w-7 shrink-0" aria-hidden="true" />
          </div>

          {/* To */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0 w-10">To</span>
            <div className="flex-1">
              <StationSearch
                onSelect={setLandingDestination}
                placeholder="Filter by destination (optional)"
              />
            </div>
            <div className="w-7 shrink-0 flex items-center justify-center">
              {landingDestination && (
                <button
                  onClick={() => setLandingDestination(null)}
                  className="text-text-muted hover:text-status-cancelled text-xs"
                  aria-label="Clear destination"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-2">
          Try 'Euston', 'Manchester', or 'KGX'
        </p>
      </div>

      {/* Favourite Journeys */}
      {favourites.length > 0 ? (
        <div className="w-full sm:max-w-xl mb-6 px-2 sm:px-0">
          <h3 className="text-xs uppercase tracking-wider text-favourite mb-3 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-favourite" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            Favourite Journeys
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            {visibleFavourites.map((journey, i) => (
              <FavouriteCard
                key={`${journey.from.crsCode}-${journey.to?.crsCode ?? "any"}-${i}`}
                journey={journey}
                onSelect={onStationSelect}
                onUnfavourite={
                  onToggleFavourite
                    ? () => onToggleFavourite(journey.from, journey.to)
                    : undefined
                }
              />
            ))}
            {/* "+N more" link when hiding extras on mobile */}
            {!showAllFavourites && hiddenCount > 0 && (
              <button
                onClick={() => setShowAllFavourites(true)}
                className="flex items-center justify-center p-3 rounded-xl border border-dashed border-border-default text-sm text-text-secondary hover:text-text-primary hover:border-border-emphasis hover:bg-surface-hover transition-colors sm:hidden"
              >
                +{hiddenCount} more
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted text-center mb-6">
          ⭐ Favourite a journey from the board to add it here
        </p>
      )}

      {/* Quick Access: Recent + Popular */}
      {(recentStations.length > 0 || POPULAR_STATIONS.length > 0) && (
        <div className="w-full sm:max-w-xl mb-6 px-2 sm:px-0">
          <h3 className="text-xs uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick Access
          </h3>
          <div className="flex flex-col gap-4">
            {recentStations.length > 0 && (
              <StationChips
                stations={recentStations.slice(0, 8)}
                onSelect={onStationSelect}
                title="Recent"
                variant="recent"
                icon={
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            )}
            <StationChips
              stations={POPULAR_STATIONS}
              onSelect={onStationSelect}
              title="Popular Stations"
              icon={
                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}