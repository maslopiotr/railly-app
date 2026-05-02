import { useState, useCallback } from "react";
import type { StationSearchResult } from "@railly-app/shared";

export interface FavouriteJourney {
  from: StationSearchResult;
  to: StationSearchResult | null;
}

const NEW_STORAGE_KEY = "railly-favourite-journeys";
const OLD_STORAGE_KEY = "railly-favourite-stations";
const MAX_FAVOURITES = 12;

function loadFavourites(): FavouriteJourney[] {
  // Try new key first
  try {
    const stored = localStorage.getItem(NEW_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as FavouriteJourney[];
  } catch (err) {
    console.error("Failed to load favourite journeys:", err);
  }

  // Migrate from old key (single-station favourites)
  try {
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const oldFavs = JSON.parse(old) as StationSearchResult[];
      const migrated = oldFavs.map((s) => ({ from: s, to: null } satisfies FavouriteJourney));
      localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(OLD_STORAGE_KEY);
      return migrated;
    }
  } catch (err) {
    console.error("Failed to migrate old favourite stations:", err);
  }

  return [];
}

export function useFavourites() {
  const [favourites, setFavourites] = useState<FavouriteJourney[]>(loadFavourites);

  const toggleFavourite = useCallback(
    (fromStation: StationSearchResult, toStation: StationSearchResult | null) => {
      setFavourites((prev) => {
        const toCrs = toStation?.crsCode ?? null;
        const exists = prev.some(
          (j) => j.from.crsCode === fromStation.crsCode && (j.to?.crsCode ?? null) === toCrs,
        );

        let updated: FavouriteJourney[];
        if (exists) {
          updated = prev.filter(
            (j) => !(j.from.crsCode === fromStation.crsCode && (j.to?.crsCode ?? null) === toCrs),
          );
        } else {
          updated = [...prev, { from: fromStation, to: toStation }].slice(0, MAX_FAVOURITES);
        }

        try {
          localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(updated));
        } catch (err) {
          console.error("Failed to save favourite journeys:", err);
        }
        return updated;
      });
    },
    [],
  );

  const isFavourite = useCallback(
    (fromCrs: string, toCrs: string | null) =>
      favourites.some(
        (j) => j.from.crsCode === fromCrs && (j.to?.crsCode ?? null) === toCrs,
      ),
    [favourites],
  );

  return { favourites, toggleFavourite, isFavourite };
}