import { useState, useEffect, useCallback, useRef } from "react";
import { searchStations } from "../api/stations";
import type { StationSearchResult } from "@railly-app/shared";

interface StationSearchProps {
  onSelect: (station: StationSearchResult) => void;
  placeholder?: string;
}

export function StationSearch({
  onSelect,
  placeholder = "Search for a station...",
}: StationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StationSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length === 0) {
      setResults([]);
      setIsDropdownOpen(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await searchStations(searchQuery);
      setResults(data.stations);
      setIsDropdownOpen(data.stations.length > 0);
      setSelectedIndex(-1);
    } catch (err) {
      console.error("Station search failed:", err);
      setResults([]);
      setIsDropdownOpen(false);
      // Show user-friendly error message
      if (err instanceof Response && err.status === 429) {
        setErrorMessage("Too many requests. Please wait a moment.");
      } else {
        setErrorMessage("Search failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      search(query);
    }, 250);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(station: StationSearchResult) {
    setQuery(station.name);
    setIsDropdownOpen(false);
    setSelectedIndex(-1);
    onSelect(station);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isDropdownOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : prev,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
      setSelectedIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setErrorMessage(null); }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsDropdownOpen(true);
          }}
          placeholder={placeholder}
          className="w-full px-4 py-3 pl-10 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label="Search for a station"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
          role="combobox"
        />
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              className="w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          )}
        </div>
      </div>

      {isDropdownOpen && results.length > 0 && (
        <ul
          className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-lg overflow-hidden"
          role="listbox"
        >
          {results.map((station, index) => (
            <li
              key={station.crsCode}
              onClick={() => handleSelect(station)}
              className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                index === selectedIndex
                  ? "bg-blue-600 text-white"
                  : "text-slate-200 hover:bg-slate-700"
              }`}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="font-medium">{station.name}</span>
              <span className="text-xs font-mono bg-slate-700 px-2 py-0.5 rounded ml-2">
                {station.crsCode}
              </span>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <div className="absolute z-10 w-full mt-1 bg-red-900/50 border border-red-700 rounded-lg shadow-lg px-4 py-3 text-red-300 text-sm">
          {errorMessage}
        </div>
      )}

      {!errorMessage && isDropdownOpen && query.length > 0 && results.length === 0 && !isLoading && (
        <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-lg px-4 py-3 text-slate-400 text-sm">
          No stations found
        </div>
      )}
    </div>
  );
}