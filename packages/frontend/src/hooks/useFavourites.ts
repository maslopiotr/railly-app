import { useState, useCallback } from "react";
import type { StationSearchResult } from "@railly-app/shared";

const STORAGE_KEY = "railly-favourite-stations";
const MAX_FAVOURITES = 12;

function loadFavourites(): StationSearchResult[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error("Failed to load favourite stations:", err);
  }
  return [];
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<StationSearchResult[]>(loadFavourites);

  const addFavourite = useCallback((station: StationSearchResult) => {
    setFavourites((prev) => {
      // Don't add duplicates
      if (prev.some((s) => s.crsCode === station.crsCode)) return prev;
      // Add to end, limit to MAX_FAVOURITES
      const updated = [...prev, station].slice(0, MAX_FAVOURITES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save favourite stations:", err);
      }
      return updated;
    });
  }, []);

  const removeFavourite = useCallback((crsCode: string) => {
    setFavourites((prev) => {
      const updated = prev.filter((s) => s.crsCode !== crsCode);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save favourite stations:", err);
      }
      return updated;
    });
  }, []);

  const toggleFavourite = useCallback((station: StationSearchResult) => {
    setFavourites((prev) => {
      const isFav = prev.some((s) => s.crsCode === station.crsCode);
      let updated: StationSearchResult[];
      if (isFav) {
        updated = prev.filter((s) => s.crsCode !== station.crsCode);
      } else {
        updated = [...prev, station].slice(0, MAX_FAVOURITES);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save favourite stations:", err);
      }
      return updated;
    });
  }, []);

  const isFavourite = useCallback(
    (crsCode: string) => favourites.some((s) => s.crsCode === crsCode),
    [favourites]
  );

  return { favourites, addFavourite, removeFavourite, toggleFavourite, isFavourite };
}