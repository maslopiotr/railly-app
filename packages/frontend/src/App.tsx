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

/** Determine if a service is an arrival based on its timetable fields */
function isArrivalService(service: HybridBoardService): boolean {
  return service.sta !== null && service.std === null;
}

function App() {
  const [selectedStation, setSelectedStation] = useState<StationSearchResult | null>(null);
  const [selectedService, setSelectedService] = useState<HybridBoardService | null>(null);
  const [destinationStation, setDestinationStation] = useState<StationSearchResult | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isServiceRefreshing, setIsServiceRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recentStations, addRecentStation } = useRecentStations();
  const { favourites, toggleFavourite, isFavourite } = useFavourites();
  const { theme, toggleTheme } = useTheme();

  const abortRef = useRef<AbortController | null>(null);

  // ── Build URL for the current navigation state ──
  const navigateTo = useCallback(
    (
      station: StationSearchResult | null,
      service: HybridBoardService | null,
      dest: StationSearchResult | null,
    ) => {
      const url = buildUrl(station, service, null, dest);
      window.history.pushState(null, "", url);
    },
    [],
  );

  // ── Restore navigation state from URL ──
  // Called on initial mount and on popstate events.
  // Fetches the board once to resolve station name and (if rid present) the service.
  const restoreFromUrl = useCallback(() => {
    const parsed = parseUrl();

    // Create new controller before aborting old one to avoid racing
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setDestinationStation(parsed.destinationStation);
    setSelectedService(null);
    setError(null);

    if (!parsed.station) {
      setSelectedStation(null);
      setIsRestoring(false);
      return;
    }

    // We have a station — fetch the board once to get stationName + optional service
    setSelectedStation(parsed.station);
    setIsRestoring(true);

    fetchBoard(parsed.station.crsCode, {
      destination: parsed.destinationStation?.crsCode || undefined,
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;

        // Update station name from the API response (canonical source)
        if (data.stationName) {
          const stationName: string = data.stationName;
          setSelectedStation((prev) => {
            if (!prev || prev.crsCode !== parsed.station?.crsCode) return prev;
            return { name: stationName, crsCode: prev.crsCode, tiploc: prev.tiploc };
          });
        }

        if (parsed.rid) {
          const service = data.services.find((s) => s.rid === parsed.rid);
          if (service) {
            setSelectedService(service);
          }
          // If service not found, just show the board (no error)
        }

        setIsRestoring(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load station data");
        setIsRestoring(false);
      });
  }, []);

  // ── Initial load + popstate listener ──
  useEffect(() => {
    restoreFromUrl();

    window.addEventListener("popstate", restoreFromUrl);
    return () => {
      window.removeEventListener("popstate", restoreFromUrl);
      abortRef.current?.abort();
    };
  }, [restoreFromUrl]);

  // ── Event handlers ──

  function handleStationSelect(station: StationSearchResult, dest?: StationSearchResult | null) {
    const destToUse = dest !== undefined ? dest : destinationStation;
    addRecentStation(station);
    if (destToUse) setDestinationStation(destToUse);
    setSelectedStation(station);
    setSelectedService(null);
    setError(null);
    navigateTo(station, null, destToUse);
  }

  function handleDestinationSelect(dest: StationSearchResult | null) {
    setDestinationStation(dest);
    navigateTo(selectedStation, selectedService, dest);
  }

  function handleSelectService(service: HybridBoardService) {
    setSelectedService(service);
    navigateTo(selectedStation, service, destinationStation);
  }

  function handleBackFromService() {
    setSelectedService(null);
    navigateTo(selectedStation, null, destinationStation);
  }

  function handleGoHome() {
    setSelectedStation(null);
    setSelectedService(null);
    setDestinationStation(null);
    setError(null);
    navigateTo(null, null, null);
  }

  function handleBackFromBoard() {
    setSelectedStation(null);
    setSelectedService(null);
    setDestinationStation(null);
    setError(null);
    navigateTo(null, null, null);
  }

  // ── Service refresh ──
  async function handleRefreshService() {
    if (!selectedStation || !selectedService || isServiceRefreshing) return;

    const controller = new AbortController();
    abortRef.current?.abort();
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
        navigateTo(selectedStation, null, destinationStation);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) {
        setIsServiceRefreshing(false);
      }
    }
  }

  // ── Render ──

  const themeTitle =
    theme === "light" ? "Switch to dark mode" : "Switch to light mode";

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
            <svg className="w-5 h-5">
              <use href={theme === "light" ? "/icons.svg#moon-icon" : "/icons.svg#sun-icon"} />
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-3 sm:px-2 py-6 sm:py-0">
        <ErrorBoundary>
          {isRestoring ? (
            /* Loading state during URL restoration */
            <div className="w-full max-w-6xl mx-auto animate-fade-slide-up py-12 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-text-muted">Loading station data…</span>
              </div>
            </div>
          ) : error ? (
            /* Error state when URL restoration fails */
            <div className="w-full max-w-6xl mx-auto animate-fade-slide-up py-12 flex flex-col items-center gap-4">
              <div className="bg-status-cancelled/10 border border-status-cancelled/30 rounded-lg px-6 py-4 text-center">
                <p className="text-sm font-medium text-status-cancelled">Unable to load station</p>
                <p className="text-xs text-text-muted mt-1">{error}</p>
                <button
                  onClick={handleGoHome}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  Return to home
                </button>
              </div>
            </div>
          ) : selectedService && selectedStation ? (
            /* Level 3: Service Detail */
            <div className="w-full max-w-2xl animate-fade-slide-right">
              <ServiceDetail
                service={selectedService}
                isArrival={isArrivalService(selectedService)}
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
              isFavourite={isFavourite(selectedStation.crsCode, destinationStation?.crsCode ?? null)}
              onToggleFavourite={() => toggleFavourite(selectedStation, destinationStation)}
              onBack={handleBackFromBoard}
              onStationChange={handleStationSelect}
              onSelectService={handleSelectService}
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