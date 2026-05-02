/**
 * useBoard — Hook for board data fetching, polling, pull-to-refresh,
 * time navigation, and all derived state.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { HybridBoardService, HybridBoardResponse } from "@railly-app/shared";
import { fetchBoard } from "../api/boards";

interface UseBoardOptions {
  crsCode: string;
  boardType: "departures" | "arrivals";
  destinationFilter: string | null;
  pageSize?: number;
}

interface UseBoardReturn {
  board: HybridBoardResponse | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  lastRefreshed: Date | null;
  allServices: HybridBoardService[];
  hasMore: boolean;
  relativeTime: string;
  displayTime: string;
  timeWindowOffset: number;
  pullDistance: number;
  isRefreshing: boolean;
  loadBoard: (silent?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  handleEarlier: () => void;
  handleLater: () => void;
  handleNow: () => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

const PULL_THRESHOLD = 60;
const POLL_INTERVAL = 60_000;

export function useBoard({
  crsCode,
  boardType,
  destinationFilter,
  pageSize = 15,
}: UseBoardOptions): UseBoardReturn {
  const [board, setBoard] = useState<HybridBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [allServices, setAllServices] = useState<HybridBoardService[]>([]);
  const [hasMore, setHasMore] = useState(false);

  // Relative time string
  const [relativeTime, setRelativeTime] = useState<string>("");

  // Display clock time (HH:MM) — auto-updates when live, static when time-shifted
  const [displayTime, setDisplayTime] = useState(() => {
    const now = new Date();
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  });

  // Time window navigation — offset from "now" in minutes (0 = live mode)
  const [timeWindowOffset, setTimeWindowOffset] = useState(0);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Compute the HH:MM time string and YYYY-MM-DD date for the current offset, or nulls for live mode */
  const computeRequestTime = useCallback((): { time: string | null; date: string | null } => {
    if (timeWindowOffset === 0) return { time: null, date: null }; // live mode

    const now = new Date();
    // Use UK-local date/time to calculate the target correctly
    const ukTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);

    const dateParts = ukTime.split(", ")[0].split("/");
    const timePart = ukTime.split(", ")[1];
    const currentDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    const currentMinutes = parseInt(timePart.split(":")[0]) * 60 + parseInt(timePart.split(":")[1]);

    const targetMinutes = currentMinutes + timeWindowOffset;
    const adjustedMinutes = ((targetMinutes % 1440) + 1440) % 1440; // wrap around midnight
    const dayOffset = Math.floor((currentMinutes + timeWindowOffset) / 1440);

    const h = Math.floor(adjustedMinutes / 60);
    const m = adjustedMinutes % 60;

    // Compute the actual UK-local target date
    const targetDateObj = new Date(currentDate + "T12:00:00Z");
    targetDateObj.setUTCDate(targetDateObj.getUTCDate() + dayOffset);
    const targetDate = targetDateObj.toISOString().split("T")[0];

    return {
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      date: targetDate,
    };
  }, [timeWindowOffset]);

  const loadBoard = useCallback(
    async (silent = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!silent) {
          setBoard(null);
          setIsLoading(true);
        }
        const { time: reqTime, date: reqDate } = computeRequestTime();
        const data = await fetchBoard(crsCode, {
          limit: pageSize,
          type: boardType,
          destination: destinationFilter || undefined,
          time: reqTime ?? undefined,
          date: reqDate ?? undefined,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setBoard(data);
          setAllServices(data.services);
          setHasMore(data.hasMore);
          setError(null);
          setLastRefreshed(new Date());
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load board");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [crsCode, boardType, destinationFilter, computeRequestTime, pageSize],
  );

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const { time: reqTime, date: reqDate } = computeRequestTime();
      const data = await fetchBoard(crsCode, {
        limit: pageSize,
        offset: allServices.length,
        type: boardType,
        destination: destinationFilter || undefined,
        time: reqTime ?? undefined,
        date: reqDate ?? undefined,
      });
      setAllServices((prev) => [...prev, ...data.services]);
      setHasMore(data.hasMore);
    } catch (err: unknown) {
      console.error("Failed to load more services:", err instanceof Error ? err.message : err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, crsCode, boardType, destinationFilter, computeRequestTime, allServices.length, pageSize]);

  // Load on mount and when tab/destination changes
  useEffect(() => {
    loadBoard();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadBoard]);

  // Update relative time and live clock display every 10 seconds
  useEffect(() => {
    const updateRelativeTime = () => {
      if (!lastRefreshed) {
        setRelativeTime("");
        return;
      }
      const seconds = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
      if (seconds < 5) setRelativeTime("just now");
      else if (seconds < 60) setRelativeTime(`${seconds}s ago`);
      else if (seconds < 120) setRelativeTime("1m ago");
      else setRelativeTime(`${Math.floor(seconds / 60)}m ago`);
    };

    const updateLiveClock = () => {
      if (timeWindowOffset !== 0) return;
      const now = new Date();
      const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
      setDisplayTime(time);
    };

    updateRelativeTime();
    updateLiveClock();
    const id = setInterval(() => {
      updateRelativeTime();
      updateLiveClock();
    }, 10_000);
    return () => clearInterval(id);
  }, [lastRefreshed, timeWindowOffset]);

  // Auto-poll every 60 seconds when tab is visible
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        loadBoard(true);
      }, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startPolling();
        loadBoard(true);
      } else {
        stopPolling();
        abortRef.current?.abort();
      }
    };

    if (document.visibilityState === "visible") {
      startPolling();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadBoard]);

  // Update displayTime when time window offset changes (non-live modes)
  useEffect(() => {
    if (timeWindowOffset !== 0) {
      const { time } = computeRequestTime();
      if (time) setDisplayTime(time);
    }
  }, [timeWindowOffset, computeRequestTime]);

  // ── Time navigation helpers (Earlier/Later by 60 minutes) ──
  const handleEarlier = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset((prev) => prev - 60);
  }, []);

  const handleLater = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset((prev) => prev + 60);
  }, []);

  const handleNow = useCallback(() => {
    setAllServices([]);
    setHasMore(false);
    setTimeWindowOffset(0);
  }, []);

  // ── Pull-to-refresh handlers ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = listRef.current;
    if (!container) return;
    if (container.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    } else {
      touchStartY.current = 0;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY.current === 0 || isRefreshing) return;
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) {
        setPullDistance(Math.min(diff, PULL_THRESHOLD * 1.5));
      }
    },
    [isRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(0);
      loadBoard();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, loadBoard]);

  return {
    board,
    isLoading,
    isLoadingMore,
    error,
    lastRefreshed,
    allServices,
    hasMore,
    relativeTime,
    displayTime,
    timeWindowOffset,
    pullDistance,
    isRefreshing,
    loadBoard,
    loadMore,
    handleEarlier,
    handleLater,
    handleNow,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    listRef,
  };
}