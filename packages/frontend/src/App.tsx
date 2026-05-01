import { useState, useEffect, useCallback, useRef } from "react";
import { StationSearch } from "./components/StationSearch";
import { DepartureBoard } from "./components/DepartureBoard";
import { ServiceDetail } from "./components/ServiceDetail";
import { TimePicker } from "./components/TimePicker";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useRecentStations } from "./hooks/useRecentStations";
import { useFavourites } from "./hooks/useFavourites";
import { useTheme } from "./hooks/useTheme";
import { fetchBoard } from "./api/boards";
import type { StationSearchResult, HybridBoardService } from "@railly-app/shared";
import { normaliseStationName } from "@railly-app/shared";

// Popular UK stations for quick access
const POPULAR_STATIONS: StationSearchResult[] = [
  { name: "London Euston", crsCode: "EUS", tiploc: "EUSTON" },
  { name: "London King's Cross", crsCode: "KGX", tiploc: "KNGX" },
  { name: "London Paddington", crsCode: "PAD", tiploc: "PADTON" },
  { name: "Manchester Piccadilly", crsCode: "MAN", tiploc: "MANPIC" },
  { name: "Birmingham New Street", crsCode: "BHM", tiploc: "BHAMNWS" },
  { name: "Edinburgh Waverley", crsCode: "EDB", tiploc: "EDINBUR" },
  { name: "Leeds", crsCode: "LDS", tiploc: "LEEDS" },
  { name: "Reading", crsCode: "RDG", tiploc: "RDNG" },
];

/** Build URL for a given navigation state */
function buildUrl(
  station: StationSearchResult | null,
  service: HybridBoardService | null,
  time: string | null,
): string {
  if (!station) return "/";
  const name = station.name;
  const params = new URLSearchParams();
  params.set("name", name);
  if (time) params.set("time", time);
  const qs = params.toString();
  if (service) {
    return `/stations/${station.crsCode}/${service.rid}?${qs}`;
  }
  return `/stations/${station.crsCode}?${qs}`;
}

/** Parse the current URL to restore navigation state */
function parseUrl(): {
  station: StationSearchResult | null;
  rid: string | null;
  time: string | null;
} {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const name = decodeURIComponent(params.get("name") || "");
  const time = params.get("time");

  const match = path.match(/^\/stations\/([A-Z]{3})(?:\/(\d+))?\/?$/i);
  if (!match)
    return {
      station: null,
      rid: null,
      time: time && /^(\d{2}):(\d{2})$/.test(time) ? time : null,
    };

  const crs = match[1].toUpperCase();
  const rid = match[2] || null;

  return {
    station: { name, crsCode: crs, tiploc: "" },
    rid,
    time: time && /^(\d{2}):(\d{2})$/.test(time) ? time : null,
  };
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
    <div className="text-3xl sm:text-4xl font-mono font-bold text-text-primary tracking-tight">
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

function App() {
  const [selectedStation, setSelectedStation] = useState<StationSearchResult | null>(null);
  const [selectedService, setSelectedService] = useState<HybridBoardService | null>(null);
  const { recentStations, addRecentStation } = useRecentStations();
  const { favourites, toggleFavourite, isFavourite } = useFavourites();
  const { theme, toggleTheme } = useTheme();

  const themeIcon = theme === "light" ? "🌞" : "🌙";
  const themeTitle =
    theme === "light" ? "Switch to dark mode" : "Switch to light mode";

  // Board tab state — lifted so it persists across service detail navigation
  const [activeTab, setActiveTab] = useState<"departures" | "arrivals">("departures");

  // Selected time-of-day (HH:MM) or null for "now"
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // Service refresh state
  const [isServiceRefreshing, setIsServiceRefreshing] = useState(false);

  // AbortController for in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  // Navigate to a URL via pushState (for in-app navigation)
  const navigateTo = useCallback(
    (
      station: StationSearchResult | null,
      service: HybridBoardService | null,
      time: string | null,
    ) => {
      const url = buildUrl(station, service, time);
      window.history.pushState(null, "", url);
    },
    [],
  );

  // Handle station selection
  function handleStationSelect(station: StationSearchResult) {
    addRecentStation(station);
    setSelectedStation(station);
    setSelectedService(null);
    navigateTo(station, null, selectedTime);
  }

  // Handle service selection
  function handleSelectService(service: HybridBoardService) {
    const isArrival = service.sta !== null && service.std === null;
    setActiveTab(isArrival ? "arrivals" : "departures");
    setSelectedService(service);
    navigateTo(selectedStation, service, selectedTime);
  }

  // Handle back from service detail
  function handleBackFromService() {
    setSelectedService(null);
    navigateTo(selectedStation, null, selectedTime);
  }

  // Handle "Railly" logo click — go to landing page
  function handleLogoClick() {
    setSelectedStation(null);
    setSelectedService(null);
    setSelectedTime(null);
    navigateTo(null, null, null);
  }

  // Handle time change from board view
  function handleTimeChange(time: string | null) {
    setSelectedTime(time);
    navigateTo(selectedStation, selectedService, time);
  }

  // Handle back from board
  function handleBackFromBoard() {
    setSelectedStation(null);
    setSelectedService(null);
    navigateTo(null, null, null);
  }

  // Refresh service data by re-fetching the board
  async function handleRefreshService() {
    if (!selectedStation || !selectedService || isServiceRefreshing) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsServiceRefreshing(true);
    try {
      const data = await fetchBoard(selectedStation.crsCode, {
        time: selectedTime || undefined,
        signal: controller.signal,
      });

      const updated = data.services.find((s) => s.rid === selectedService.rid);
      if (updated) {
        setSelectedService(updated);
      } else {
        setSelectedService(null);
        navigateTo(selectedStation, null, selectedTime);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) {
        setIsServiceRefreshing(false);
      }
    }
  }

  // Restore state from URL on mount, and listen for browser back/forward
  useEffect(() => {
    function handlePopState() {
      const { station, rid, time } = parseUrl();
      setSelectedTime(time);
      if (station) {
        setSelectedStation(station);
        if (rid) {
          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          fetchBoard(station.crsCode, {
            time: time || undefined,
            signal: controller.signal,
          })
            .then((data) => {
              if (controller.signal.aborted) return;
              const service = data.services.find((s) => s.rid === rid);
              if (service) {
                setSelectedService(service);
                const isArrival = service.sta !== null && service.std === null;
                setActiveTab(isArrival ? "arrivals" : "departures");
              } else {
                setSelectedService(null);
                window.history.replaceState(null, "", buildUrl(station, null, time));
              }
            })
            .catch(() => {
              setSelectedService(null);
            });
        } else {
          setSelectedService(null);
        }
      } else {
        setSelectedStation(null);
        setSelectedService(null);
      }
    }

    // Restore state from URL on initial load
    const { station, rid, time } = parseUrl();
    setSelectedTime(time);
    if (station) {
      setSelectedStation(station);
      if (rid) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        fetchBoard(station.crsCode, {
          time: time || undefined,
          signal: controller.signal,
        })
          .then((data) => {
            if (controller.signal.aborted) return;
            const service = data.services.find((s) => s.rid === rid);
            if (service) {
              setSelectedService(service);
              const isArrival = service.sta !== null && service.std === null;
              setActiveTab(isArrival ? "arrivals" : "departures");
            }
            if (data.stationName) {
              setSelectedStation({ ...station, name: data.stationName });
            }
          })
          .catch(() => {});
      } else {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        fetchBoard(station.crsCode, {
          time: time || undefined,
          signal: controller.signal,
        })
          .then((data) => {
            if (controller.signal.aborted) return;
            if (data.stationName) {
              setSelectedStation({ ...station, name: data.stationName });
            }
          })
          .catch(() => {});
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      abortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-surface-page text-text-primary font-sans overflow-x-hidden flex flex-col">
      {/* ─── Header ─── */}
      <header className="px-4 sm:px-6 py-3 border-b border-border-default flex items-center justify-between bg-surface-card">
        <button
          onClick={handleLogoClick}
          className="text-lg sm:text-xl font-bold tracking-tight transition-opacity duration-150 hover:opacity-80 active:opacity-60 text-text-primary cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          aria-label="Go to home page"
        >
          Railly
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs sm:text-sm text-text-muted">Rail Buddy</span>
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            aria-label={themeTitle}
            title={themeTitle}
          >
            {themeIcon}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-6 sm:py-8">
        <ErrorBoundary>
          {selectedService && selectedStation ? (
            /* Level 3: Service Detail */
            <div className="w-full max-w-2xl animate-fade-slide-right">
              <ServiceDetail
                service={selectedService}
                isArrival={activeTab === "arrivals"}
                stationCrs={selectedStation.crsCode}
                onBack={handleBackFromService}
                onRefresh={handleRefreshService}
                isRefreshing={isServiceRefreshing}
              />
            </div>
          ) : selectedStation ? (
            /* Level 2: Departure Board */
            <DepartureBoard
              station={selectedStation}
              isFavourite={isFavourite(selectedStation.crsCode)}
              onToggleFavourite={() => toggleFavourite(selectedStation)}
              onBack={handleBackFromBoard}
              onSelectService={handleSelectService}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              selectedTime={selectedTime}
              onTimeChange={handleTimeChange}
            />
          ) : (
            /* Level 1: Landing */
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

              {/* Search + Time picker */}
              <div className="w-full flex flex-col items-center mb-6">
                <div className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-center gap-3">
                  <div className="w-full sm:flex-1 sm:max-w-md">
                    <StationSearch
                      onSelect={handleStationSelect}
                      placeholder="Search for a station..."
                      autoFocus
                      size="large"
                    />
                  </div>
                  <div className="sm:shrink-0 flex justify-center">
                    <TimePicker value={selectedTime} onChange={setSelectedTime} />
                  </div>
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
                        onClick={() => handleStationSelect(station)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleStationSelect(station);
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
                        <button
                          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-xs rounded-full transition-all duration-150 text-text-muted hover:text-status-cancelled hover:bg-surface-hover active:scale-90 focus-visible:ring-2 focus-visible:ring-blue-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavourite(station);
                          }}
                          aria-label={`Remove ${normaliseStationName(station.name)} from favourites`}
                          title="Remove from favourites"
                        >
                          ✕
                        </button>
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
                    onSelect={handleStationSelect}
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
                onSelect={handleStationSelect}
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
          )}
        </ErrorBoundary>
      </main>

      {/* ─── Footer ─── */}
      <footer className="px-4 sm:px-6 py-4 text-center text-xs text-text-muted border-t border-border-default bg-surface-card">
        © 2026 Railly · Data from National Rail Enquiries
      </footer>
    </div>
  );
}

export default App;