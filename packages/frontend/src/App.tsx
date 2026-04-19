import { useState, useEffect } from "react";
import { StationSearch } from "./components/StationSearch";
import { DepartureBoard } from "./components/DepartureBoard";
import { useRecentStations } from "./hooks/useRecentStations";
import type { StationSearchResult } from "@railly-app/shared";

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

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formattedTime = time.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
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
            className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-full text-sm text-slate-300 hover:bg-slate-700 hover:text-white hover:border-slate-600 transition-colors flex items-center gap-1.5"
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
  const { recentStations, addRecentStation } = useRecentStations();

  function handleStationSelect(station: StationSearchResult) {
    addRecentStation(station);
    setSelectedStation(station);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white overflow-x-hidden flex flex-col">
      <header className="px-4 sm:px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight">
          Railly
        </h1>
        <span className="text-xs sm:text-sm text-slate-500">Rail Buddy</span>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-6 sm:py-8">
        {selectedStation ? (
          <DepartureBoard
            station={selectedStation}
            onBack={() => setSelectedStation(null)}
          />
        ) : (
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

            {/* Search */}
            <div className="w-full flex flex-col items-center mb-6">
              <StationSearch
                onSelect={handleStationSelect}
                placeholder="Search for a station..."
                autoFocus
                size="large"
              />
              <p className="text-xs text-slate-500 mt-2">
                Try 'Euston', 'Manchester', or 'KGX'
              </p>
            </div>

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