import { useState } from "react";
import { StationSearch } from "./components/StationSearch";
import { DepartureBoard } from "./components/DepartureBoard";
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

      <main className="flex flex-col items-center px-6 py-8">
        {/* Station Search */}
        <div className="w-full flex flex-col items-center mb-6">
          <StationSearch
            onSelect={(station) => {
              setSelectedStation(station);
            }}
            placeholder="Search for a station..."
          />
        </div>

        {/* Departure Board or Landing */}
        {selectedStation ? (
          <DepartureBoard
            station={selectedStation}
            onBack={() => setSelectedStation(null)}
          />
        ) : (
          <div className="text-center py-8">
            <h2 className="text-4xl font-bold mb-4">
              Your UK Train companion
            </h2>
            <p className="text-lg text-slate-300 mb-8 max-w-md">
              Search for any station to see live departures, arrivals, and
              disruption info.
            </p>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-2xl w-full mx-auto">
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
          </div>
        )}
      </main>

      <footer className="px-6 py-4 text-center text-sm text-slate-500 border-t border-slate-700">
        Railly - Rail Buddy &copy; 2026. Data sourced from National Rail Enquiries. Not affiliated with any train operator.
      </footer>
    </div>
  );
}

export default App;