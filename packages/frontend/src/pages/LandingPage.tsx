/**
 * LandingPage — Home page with clock, search, favourites, and station chips
 */

import { useState, useEffect } from "react";
import type { StationSearchResult } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";
import { StationSearch } from "../components/shared/StationSearch";
import { POPULAR_STATIONS } from "../constants/stations";

interface LandingPageProps {
  favourites: StationSearchResult[];
  recentStations: StationSearchResult[];
  onStationSelect: (station: StationSearchResult) => void;
  onToggleFavourite?: (station: StationSearchResult) => void;
}

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

function StationChips({
  stations,
  onSelect,
  title,
  icon,
}: {
  stations: StationSearchResult[];
  onSelect: (station: StationSearchResult) => void;
  title: string;
  icon?: React.ReactNode;
}) {
  if (stations.length === 0) return null;

  return (
    <div className="w-full max-w-2xl">
      <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {stations.map((station) => (
          <button
            key={station.crsCode}
            onClick={() => onSelect(station)}
            className="transition-all duration-150 hover:scale-[1.03] active:scale-[0.97] px-3 py-1.5 bg-surface-hover border border-border-default rounded-full text-sm text-text-secondary hover:bg-surface-card hover:text-text-primary hover:border-border-emphasis flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span>{normaliseStationName(station.name)}</span>
            <span className="text-xs text-text-muted font-mono">{station.crsCode}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LandingPage({
  favourites,
  recentStations,
  onStationSelect,
  onToggleFavourite,
}: LandingPageProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl">
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
        <div className="w-full sm:max-w-md">
          <StationSearch
            onSelect={onStationSelect}
            placeholder="Search for a station..."
            autoFocus
            size="large"
          />
        </div>
        <p className="text-xs text-text-muted mt-2">
          Try 'Euston', 'Manchester', or 'KGX'
        </p>
      </div>

      {/* Favourite Stations */}
      {favourites.length > 0 ? (
        <div className="w-full mb-6">
          <h3 className="text-xs uppercase tracking-wider text-favourite mb-3 flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-favourite"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            Favourites
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {favourites.map((station) => (
              <div
                key={station.crsCode}
                className="relative flex flex-col items-start gap-0.5 p-[--spacing-card] rounded-lg border transition-all duration-150 cursor-pointer text-left bg-surface-card border-border-default hover:bg-surface-hover hover:border-favourite active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => onStationSelect(station)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStationSelect(station);
                  }
                }}
                aria-label={`View departures for ${normaliseStationName(station.name)}`}
              >
                <span className="text-sm font-medium truncate w-full text-text-primary">
                  {normaliseStationName(station.name)}
                </span>
                <span className="text-xs font-mono text-text-secondary">
                  {station.crsCode}
                </span>
                {onToggleFavourite && (
                  <button
                    className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-xs rounded-full transition-all duration-150 text-text-muted hover:text-status-cancelled hover:bg-surface-hover active:scale-90 focus-visible:ring-2 focus-visible:ring-blue-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavourite(station);
                    }}
                    aria-label={`Remove ${normaliseStationName(station.name)} from favourites`}
                    title="Remove from favourites"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted text-center mb-6">
          ⭐ Favourite a station from the board to add it here
        </p>
      )}

      {/* Recent Stations */}
      {recentStations.length > 0 && (
        <div className="mb-6">
          <StationChips
            stations={recentStations}
            onSelect={onStationSelect}
            title="Recent"
            icon={
              <svg
                className="w-3.5 h-3.5 text-text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />
        </div>
      )}

      {/* Popular Stations */}
      <StationChips
        stations={POPULAR_STATIONS}
        onSelect={onStationSelect}
        title="Popular Stations"
        icon={
          <svg
            className="w-3.5 h-3.5 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
        }
      />
    </div>
  );
}