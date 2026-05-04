/**
 * In-memory LRU cache — lightweight, zero-dependency caching for API responses
 * and reference data.
 *
 * Two cache types:
 * 1. TTLCache — time-based expiry (for board responses, reference data)
 * 2. ReferenceCache — long-lived cache for immutable data (stations, TOCs)
 *
 * Designed for single-process Node.js — no distributed locking needed.
 * Eviction is lazy (on read) + periodic sweep every 60s.
 */

/** Cache entry with metadata */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  size: number; // Approximate size in bytes (for capacity tracking)
}

/** Simple TTL-based LRU cache with size-based eviction */
export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSizeBytes: number;
  private currentSizeBytes = 0;
  private sweepInterval: ReturnType<typeof setInterval>;
  private hits = 0;
  private misses = 0;

  /**
   * @param maxSizeBytes Maximum cache size in bytes (default 50MB)
   * @param sweepIntervalMs How often to sweep expired entries (default 60s)
   */
  constructor(maxSizeBytes = 50 * 1024 * 1024, sweepIntervalMs = 60_000) {
    this.maxSizeBytes = maxSizeBytes;
    this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
    // Don't prevent process shutdown
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /** Get a cached value. Returns undefined if expired or missing. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.currentSizeBytes -= entry.size;
      this.misses++;
      return undefined;
    }
    // LRU: move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  /** Set a cached value with TTL in milliseconds */
  set(key: string, value: T, ttlMs: number): void {
    // Remove existing entry if present
    const existing = this.store.get(key);
    if (existing) {
      this.currentSizeBytes -= existing.size;
      this.store.delete(key);
    }

    // Estimate size: JSON serialise for accuracy
    const size = JSON.stringify(value).length * 2; // *2 for UTF-16
    const expiresAt = Date.now() + ttlMs;

    // Evict if over capacity (remove oldest first)
    while (this.currentSizeBytes + size > this.maxSizeBytes && this.store.size > 0) {
      const oldest = this.store.keys().next().value;
      if (oldest) {
        const oldEntry = this.store.get(oldest);
        if (oldEntry) {
          this.currentSizeBytes -= oldEntry.size;
        }
        this.store.delete(oldest);
      }
    }

    this.store.set(key, { value, expiresAt, createdAt: Date.now(), size });
    this.currentSizeBytes += size;
  }

  /** Check if a key exists and is not expired */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Delete a specific key */
  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (entry) {
      this.currentSizeBytes -= entry.size;
    }
    return this.store.delete(key);
  }

  /** Clear all entries */
  clear(): void {
    this.store.clear();
    this.currentSizeBytes = 0;
  }

  /** Remove all expired entries */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.currentSizeBytes -= entry.size;
        this.store.delete(key);
      }
    }
  }

  /** Get cache statistics */
  stats(): { entries: number; sizeBytes: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      sizeBytes: this.currentSizeBytes,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : "N/A",
    };
  }

  /** Stop the sweep interval (for graceful shutdown) */
  destroy(): void {
    clearInterval(this.sweepInterval);
    this.store.clear();
    this.currentSizeBytes = 0;
  }
}

/**
 * Reference data cache — for immutable or rarely-changing data.
 * Uses a long TTL (default 1 hour) with lazy refresh.
 * Provides a `getOrFetch` pattern to avoid duplicate queries.
 */
export class ReferenceCache<T> {
  private cache: TTLCache<T>;
  private ttlMs: number;

  constructor(ttlMs = 3_600_000, maxSizeBytes = 10 * 1024 * 1024) {
    this.ttlMs = ttlMs;
    this.cache = new TTLCache<T>(maxSizeBytes);
  }

  /** Get cached value or fetch and cache it */
  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await fetcher();
    this.cache.set(key, value, this.ttlMs);
    return value;
  }

  /** Invalidate a specific key */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Clear all cached reference data */
  clear(): void {
    this.cache.clear();
  }

  /** Get cache statistics */
  stats() {
    return this.cache.stats();
  }

  /** Destroy the cache */
  destroy(): void {
    this.cache.destroy();
  }
}

// ── Pre-configured singleton instances ───────────────────────────────────────

/** Board response cache — short TTL (10s) since data is near-real-time */
export const boardCache = new TTLCache<Record<string, unknown>>(10_000, 100 * 1024 * 1024); // 100MB max

/** Station name cache — immutable reference data (1h TTL). Note: fetchStationName returns string | null */
export const stationCache = new ReferenceCache<string | null>(3_600_000, 5 * 1024 * 1024);

/**
 * Build the board cache key from request parameters.
 * Format: board:{crs}:{type}:{time}:{date}:{destination}:{offset}:{limit}
 */
export function buildBoardCacheKey(params: {
  crs: string;
  boardType: string;
  timeParam?: string;
  dateParam?: string;
  destinationCrs?: string | null;
  offset: number;
  limit: number;
}): string {
  const { crs, boardType, timeParam, dateParam, destinationCrs, offset, limit } = params;
  const timeKey = timeParam || "live";
  const dateKey = dateParam || "today";
  const destKey = destinationCrs || "all";
  return `board:${crs}:${boardType}:${timeKey}:${dateKey}:${destKey}:${offset}:${limit}`;
}