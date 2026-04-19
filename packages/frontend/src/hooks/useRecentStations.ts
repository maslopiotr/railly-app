import { useState, useCallback } from "react";
import type { StationSearchResult } from "@railly-app/shared";

const STORAGE_KEY = "railly-recent-stations";
const MAX_RECENT = 5;

function loadRecentStations(): StationSearchResult[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error("Failed to load recent stations:", err);
  }
  return [];
}

export function useRecentStations() {
  const [recentStations, setRecentStations] = useState<StationSearchResult[]>(loadRecentStations);

  // Add a station to recent list
  const addRecentStation = useCallback((station: StationSearchResult) => {
    setRecentStations((prev) => {
      // Remove if already exists (to move to front)
      const filtered = prev.filter((s) => s.crsCode !== station.crsCode);
      // Add to front, limit to MAX_RECENT
      const updated = [station, ...filtered].slice(0, MAX_RECENT);
      // Persist to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save recent stations:", err);
      }
      return updated;
    });
  }, []);

  // Clear all recent stations
  const clearRecentStations = useCallback(() => {
    setRecentStations([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear recent stations:", err);
    }
  }, []);

  return { recentStations, addRecentStation, clearRecentStations };
}