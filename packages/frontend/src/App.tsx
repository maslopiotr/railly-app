import { useState } from "react";
import { StationSearch } from "./components/StationSearch";
import type { StationSearchResult } from "@railly-app/shared";

function App() {
  const [selectedStation, setSelectedStation] =
    useState<StationSearchResult | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <header className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-bold tracking-tight">
          🚂 Rail Buddy
        </h1>
      </header>

      <main className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <h2 className="text-4xl font-bold mb-4">
          Your UK Train Companion
        </h2>
        <p className="text-lg text-slate-300 mb-8 max-w-md">
          Search for any station to see live departures, arrivals, and
          disruption info.
        </p>

        {/* Station Search */}
        <div className="w-full flex flex-col items-center mb-12">
          <StationSearch
            onSelect={(station) => {
              setSelectedStation(station);
            }}
            placeholder="Search for a station..."
          />

          {selectedStation && (
            <div className="mt-4 p-4 bg-slate-800 border border-slate-600 rounded-lg text-left max-w-md w-full">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {selectedStation.name}
                </h3>
                <span className="text-sm font-mono bg-blue-600 px-2 py-0.5 rounded">
                  {selectedStation.crsCode}
                </span>
              </div>
              {selectedStation.tiploc && (
                <p className="text-xs text-slate-400 mt-1">
                  TIPLOC: {selectedStation.tiploc}
                </p>
              )}
              <p className="text-sm text-slate-400 mt-2">
                🚧 Departure board coming in Step 2
              </p>
            </div>
          )}
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-2xl w-full">
          {[
            { icon: "📍", title: "Live Tracking", desc: "Real-time train positions" },
            { icon: "🚉", title: "Departure Boards", desc: "Next trains at any station" },
            { icon: "⚠️", title: "Disruption Alerts", desc: "Delay & cancellation notifications" },
            { icon: "💷", title: "Delay Repay", desc: "Eligible claims at a glance" },
            { icon: "🎫", title: "Price Alerts", desc: "Cheap ticket notifications" },
            { icon: "👥", title: "Crowding Data", desc: "Train capacity info" },
          ].map((feature) => (
            <div
              key={feature.title}
              className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-left"
            >
              <span className="text-2xl">{feature.icon}</span>
              <h3 className="font-semibold mt-2">{feature.title}</h3>
              <p className="text-sm text-slate-400">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-sm text-slate-500 border-t border-slate-700">
        Rail Buddy — Self-hosted, open-source, free forever
      </footer>
    </div>
  );
}

export default App;