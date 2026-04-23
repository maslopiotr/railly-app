import { useState, useEffect, useCallback } from "react";
import { StationSearch } from "./components/StationSearch";
import { DepartureBoard } from "./components/DepartureBoard";
import { ServiceDetail } from "./components/ServiceDetail";
import { TimePicker } from "./components/TimePicker";
import { useRecentStations } from "./hooks/useRecentStations";
import { useFavourites } from "./hooks/useFavourites";
import { fetchBoard } from "./api/boards";
import type { StationSearchResult, HybridBoardService } from "@railly-app/shared";

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
function buildUrl(station: StationSearchResult | null, service: HybridBoardService | null, time: string | null): string {
  if (!station) return "/";
  const name = encodeURIComponent(station.name);
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
function parseUrl(): { station: StationSearchResult | null; rid: string | null; time: string | null } {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name") || "";
  const time = params.get("time");

  // Match /stations/:crs or /stations/:crs/:rid
  const match = path.match(/^\/stations\/([A-Z]{3})(?:\/(\d+))?\/?$/i);
  if (!match) return { station: null, rid: null, time: time && /^(\d{2}):(\d{2})$/.test(time) ? time : null };

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
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <div className="text-3xl sm:text-4xl font-mono font-bold text-white tracking-tight">
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
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {stations.map((station) => (
          <button
            key={station.crsCode}
            onClick={() => onSelect(station)}
            className="chip-hover px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-full text-sm text-slate-300 hover:bg-slate-700 hover:text-white hover:border-slate-600 flex items-center gap-1.5"
          >
            <span>{station.name}</span>
            <span className="text-xs text-slate-500 font-mono">{station.crsCode}</span>
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

  // Board tab state — lifted so it persists across service detail navigation
  const [activeTab, setActiveTab] = useState<"departures" | "arrivals">("departures");

  // Selected time-of-day (HH:MM) or null for "now"
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // Service refresh state
  const [isServiceRefreshing, setIsServiceRefreshing] = useState(false);

  // Navigate to a URL via pushState (for in-app navigation)
  const navigateTo = useCallback((station: StationSearchResult | null, service: HybridBoardService | null, time: string | null) => {
    const url = buildUrl(station, service, time);
    window.history.pushState(null, "", url);
  }, []);

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

    setIsServiceRefreshing(true);
    try {
      const data = await fetchBoard(selectedStation.crsCode, {
        timeWindow: 120,
        pastWindow: 10,
        time: selectedTime || undefined,
      });

      // Find the updated service by RID
      const updated = data.services.find((s) => s.rid === selectedService.rid);
      if (updated) {
        setSelectedService(updated);
      } else {
        // Service no longer in the time window — navigate back to board
        setSelectedService(null);
        navigateTo(selectedStation, null, selectedTime);
      }
    } catch {
      // Silently fail — user can try again
    } finally {
      setIsServiceRefreshing(false);
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
          // Need to fetch the board to get the service data
          fetchBoard(station.crsCode, { timeWindow: 120, pastWindow: 10, time: time || undefined })
            .then((data) => {
              const service = data.services.find((s) => s.rid === rid);
              if (service) {
                setSelectedService(service);
                const isArrival = service.sta !== null && service.std === null;
                setActiveTab(isArrival ? "arrivals" : "departures");
              } else {
                // Service not found, show board only
                setSelectedService(null);
                navigateTo(station, null, time);
              }
            })
            .catch(() => {
              // On error, just show the board
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
        // Fetch board to get service details
        fetchBoard(station.crsCode, { timeWindow: 120, pastWindow: 10, time: time || undefined })
          .then((data) => {
            const service = data.services.find((s) => s.rid === rid);
            if (service) {
              setSelectedService(service);
              const isArrival = service.sta !== null && service.std === null;
              setActiveTab(isArrival ? "arrivals" : "departures");
            }
            // Update station name from API data
            if (data.stationName) {
              setSelectedStation({ ...station, name: data.stationName });
            }
          })
          .catch(() => {
            // On error, show board anyway
          });
      } else {
        // Fetch board just to get station name
        fetchBoard(station.crsCode, { timeWindow: 120, pastWindow: 10, time: time || undefined })
          .then((data) => {
            if (data.stationName) {
              setSelectedStation({ ...station, name: data.stationName });
            }
          })
          .catch(() => {});
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white overflow-x-hidden flex flex-col">
      <header className="px-4 sm:px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <button
          onClick={handleLogoClick}
          className="logo-btn cursor-pointer"
          aria-label="Go to home page"
        >
          Railly
        </button>
        <span className="text-xs sm:text-sm text-slate-500">Rail Buddy</span>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-6 sm:py-8">
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
            <p className="text-sm sm:text-base text-slate-400 text-center mb-8">
              Search any station to see departures, arrivals, and platform info
            </p>

            {/* Search + Time picker inline */}
            <div className="w-full flex flex-col items-center mb-6">
              <div className="w-full flex items-center justify-center gap-3">
                <div className="flex-1 max-w-md">
                  <StationSearch
                    onSelect={handleStationSelect}
                    placeholder="Search for a station..."
                    autoFocus
                    size="large"
                  />
                </div>
                <TimePicker
                  value={selectedTime}
                  onChange={setSelectedTime}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Try 'Euston', 'Manchester', or 'KGX'
              </p>
            </div>

            {/* Favourite Stations */}
            {favourites.length > 0 ? (
              <div className="w-full mb-6">
                <h3 className="text-xs uppercase tracking-wider text-amber-400/80 mb-3 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Favourites
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {favourites.map((station) => (
                    <div
                      key={station.crsCode}
                      className="favourite-card group"
                      onClick={() => handleStationSelect(station)}
                    >
                      <span className="favourite-card-name">{station.name}</span>
                      <span className="favourite-card-crs">{station.crsCode}</span>
                      <button
                        className="favourite-card-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavourite(station);
                        }}
                        aria-label={`Remove ${station.name} from favourites`}
                        title="Remove from favourites"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center mb-6">
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
                    <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              }
            />
          </div>
        )}
      </main>

      <footer className="px-4 sm:px-6 py-4 text-center text-xs text-slate-500 border-t border-slate-700">
        © 2026 Railly · Data from National Rail Enquiries
      </footer>
    </div>
  );
}

export default App;