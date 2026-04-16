/**
 * API request/response types
 */

/** Health check response */
export interface HealthResponse {
  status: "ok" | "error";
  timestamp: string;
  services: {
    database: "connected" | "disconnected";
    redis: "connected" | "disconnected";
  };
}

/** Generic API error response */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/** Station search query params */
export interface StationSearchQuery {
  q: string;
}

/** Departure board query params */
export interface DepartureBoardQuery {
  crs: string;
  numRows?: number;
}