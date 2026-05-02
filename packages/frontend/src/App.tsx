/**
 * App — Root application component
 *
 * Thin orchestrator: owns navigation state, delegates rendering to page components.
 * Three routes: LandingPage → BoardPage → ServiceDetailPage
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { LandingPage } from "./pages/LandingPage";
import { BoardPage } from "./pages/BoardPage";
import { ServiceDetail } from "./pages/ServiceDetailPage";
import { useRecentStations } from "./hooks/useRecentStations";
import { useFavourites } from "./hooks/useFavourites";
import { useTheme } from "./hooks/useTheme";
import { fetchBoard } from "./api/boards";
import type { StationSearchResult, HybridBoardService } from "@railly-app/shared";
import { buildUrl, parseUrl } from "./utils/navigation";

function App() {
  const [selectedStation, setSelectedStation] = useState<StationSearchResult | null>(null);
  const [selectedService, setSelectedService] = useState<HybridBoardService | null>(null);
  const { recentStations, addRecentStation } = useRecentStations();
  const { favourites, toggleFavourite, isFavourite } = useFavourites();
  const { theme, toggleTheme } = useTheme();

  const themeIcon = theme === "light" ? "🌞" : "🌙";
  const themeTitle =
    theme === "light" ? "Switch to dark mode" : "Switch to light mode";

  const [activeTab, setActiveTab] = useState<"departures" | "arrivals">("departures");
  const [destinationStation, setDestinationStation] = useState<StationSearchResult | null>(null);
  const [isServiceRefreshing, setIsServiceRefreshing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // ── Navigation ──
  const navigateTo = useCallback(
    (
      station: StationSearchResult | null,
      service: HybridBoardService | null,
      dest: StationSearchResult | null = destinationStation,
    ) => {
      const url = buildUrl(station, service, null, dest);
      window.history.pushState(null, "", url);
    },
    [destinationStation],
  );

  function handleStationSelect(station: StationSearchResult) {
    addRecentStation(station);
    setSelectedStation(station);
    setSelectedService(null);
    navigateTo(station, null);
  }

  function handleDestinationSelect(dest: StationSearchResult | null) {
    setDestinationStation(dest);
    navigateTo(selectedStation, selectedService, dest);
  }

  function handleSelectService(service: HybridBoardService) {
    const isArrival = service.sta !== null && service.std === null;
    setActiveTab(isArrival ? "arrivals" : "departures");
    setSelectedService(service);
    navigateTo(selectedStation, service);
  }

  function handleBackFromService() {
    setSelectedService(null);
    navigateTo(selectedStation, null);
  }

  function handleGoHome() {
    setSelectedStation(null);
    setSelectedService(null);
    setDestinationStation(null);
    navigateTo(null, null, null);
  }

  function handleBackFromBoard() {
    setSelectedStation(null);
    setSelectedService(null);
    setDestinationStation(null);
    navigateTo(null, null);
  }

  // ── Service refresh ──
  async function handleRefreshService() {
    if (!selectedStation || !selectedService || isServiceRefreshing) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsServiceRefreshing(true);
    try {
      const data = await fetchBoard(selectedStation.crsCode, {
        signal: controller.signal,
      });

      const updated = data.services.find((s) => s.rid === selectedService.rid);
      if (updated) {
        setSelectedService(updated);
      } else {
        setSelectedService(null);
        navigateTo(selectedStation, null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) {
        setIsServiceRefreshing(false);
      }
    }
  }

  // ── URL restoration on mount + popstate ──
  useEffect(() => {
    function handlePopState() {
      const { station, rid, destinationStation: dest } = parseUrl();
      setDestinationStation(dest);
      if (station) {
        setSelectedStation(station);
        if (rid) {
          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          fetchBoard(station.crsCode, {
            destination: dest?.crsCode || undefined,
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
                window.history.replaceState(null, "", buildUrl(station, null, null, dest));
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

    // Initial load
    const { station, rid, destinationStation: dest } = parseUrl();
    setDestinationStation(dest);
    if (station) {
      setSelectedStation(station);
      if (rid) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        fetchBoard(station.crsCode, {
          destination: dest?.crsCode || undefined,
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
          destination: dest?.crsCode || undefined,
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
          onClick={handleGoHome}
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

      <main className="flex-1 flex flex-col items-center px-3 sm:px-2 py-6 sm:py-0">
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
            /* Level 2: Board */
            <BoardPage
              station={selectedStation}
              isFavourite={isFavourite(selectedStation.crsCode)}
              onToggleFavourite={() => toggleFavourite(selectedStation)}
              onBack={handleBackFromBoard}
              onStationChange={handleStationSelect}
              onSelectService={handleSelectService}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              destinationStation={destinationStation}
              onDestinationChange={handleDestinationSelect}
            />
          ) : (
            /* Level 1: Landing */
            <LandingPage
              favourites={favourites}
              recentStations={recentStations}
              onStationSelect={handleStationSelect}
              onToggleFavourite={toggleFavourite}
            />
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