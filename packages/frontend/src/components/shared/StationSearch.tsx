import { useState, useEffect, useCallback, useRef } from "react";
import { searchStations } from "../../api/stations";
import { normaliseStationName } from "@railly-app/shared";
import type { StationSearchResult } from "@railly-app/shared";

interface StationSearchProps {
  onSelect: (station: StationSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  size?: "default" | "large" | "compact";
}

export function StationSearch({
  onSelect,
  placeholder = "Search for a station...",
  autoFocus = false,
  size = "default",
}: StationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StationSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Close dropdown on outside click/touch
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  function handleSelect(station: StationSearchResult) {
    setQuery(normaliseStationName(station.name));
    setIsDropdownOpen(false);
    setSelectedIndex(-1);
    onSelect(station);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isDropdownOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
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

  function handleClear() {
    setQuery("");
    setResults([]);
    setIsDropdownOpen(false);
    setErrorMessage(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }

  const isLarge = size === "large";
  const isCompact = size === "compact";

  // Input classes using semantic tokens
  const inputClasses = isLarge
    ? "px-5 py-4 pl-12 text-lg rounded-xl"
    : isCompact
      ? "px-2 py-1.5 pl-8 text-sm rounded-md"
      : "px-4 py-3 pl-10";

  const searchIconPosition = isLarge ? "pl-4" : isCompact ? "pl-2" : "pl-3";
  const searchIconSize = isLarge ? "w-5 h-5" : isCompact ? "w-3 h-3" : "w-4 h-4";

  return (
    <div ref={containerRef} className={`relative w-full ${isCompact ? "" : "max-w-md"}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setErrorMessage(null);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsDropdownOpen(true);
          }}
          placeholder={placeholder}
          className={`${inputClasses} w-full bg-surface-card border border-border-emphasis rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500`}
          aria-label="Search for a station"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
          role="combobox"
          inputMode="search"
        />
        <div
          className={`absolute inset-y-0 left-0 flex items-center pointer-events-none ${searchIconPosition}`}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              className={`${searchIconSize} text-text-muted`}
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
        {query.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className={`absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 rounded`}
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {isDropdownOpen && results.length > 0 && (
        <ul
          className="absolute z-10 w-full mt-1 bg-surface-card border border-border-default rounded-lg shadow-lg overflow-hidden"
          role="listbox"
        >
          {results.map((station, index) => (
            <li
              key={station.crsCode}
              onClick={() => handleSelect(station)}
              className={`px-4 py-3 cursor-pointer flex items-center justify-between select-none ${
                index === selectedIndex
                  ? "bg-blue-600 text-white"
                  : "text-text-primary hover:bg-surface-hover"
              }`}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="font-medium">{normaliseStationName(station.name)}</span>
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded ml-2 ${
                  index === selectedIndex
                    ? "bg-white/20 text-white"
                    : "bg-surface-hover text-text-secondary"
                }`}
              >
                {station.crsCode}
              </span>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <div className="absolute z-10 w-full mt-1 bg-alert-cancel-bg border border-alert-cancel-border rounded-lg shadow-lg px-4 py-3 text-alert-cancel-text text-sm">
          {errorMessage}
        </div>
      )}

      {!errorMessage && isDropdownOpen && query.length > 0 && results.length === 0 && !isLoading && (
        <div className="absolute z-10 w-full mt-1 bg-surface-card border border-border-default rounded-lg shadow-lg px-4 py-3 text-text-secondary text-sm">
          No stations found
        </div>
      )}
    </div>
  );
}