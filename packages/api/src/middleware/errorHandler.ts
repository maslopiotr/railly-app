import type { Request, Response, NextFunction } from "express";

/** Custom error class with HTTP status code */
class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Postgres error codes that indicate not-found */
const POSTGRES_NOT_FOUND_CODES = new Set(["23503", "42P01"]); // foreign_key_violation, undefined_table

/** Postgres error codes that indicate constraint/validation failure */
const POSTGRES_VALIDATION_CODES = new Set([
  "23502", // not_null_violation
  "23505", // unique_violation
  "23514", // check_violation
  "22P02", // invalid_text_representation
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
]);

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Default to 500 for unknown errors
  let statusCode = 500;
  let errorCode = "INTERNAL_ERROR";
  let message = "An unexpected error occurred";

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
  } else {
    // Heuristics for common error types passed via next(err)
    const pgCode = (err as unknown as { code?: string }).code;
    const pgCodeNum = (err as unknown as { code?: number }).code;

    if (pgCode && typeof pgCode === "string" && pgCode.length === 5) {
      // PostgreSQL error
      if (POSTGRES_NOT_FOUND_CODES.has(pgCode)) {
        statusCode = 404;
        errorCode = "NOT_FOUND";
        message = "Resource not found";
      } else if (POSTGRES_VALIDATION_CODES.has(pgCode)) {
        statusCode = 400;
        errorCode = "VALIDATION_ERROR";
        message = err.message || "Invalid data";
      } else if (pgCode.startsWith("08")) {
        // Connection errors
        statusCode = 503;
        errorCode = "DATABASE_UNAVAILABLE";
        message = "Database temporarily unavailable";
      } else {
        // Other DB errors — don't leak internal details
        statusCode = 500;
        errorCode = "DATABASE_ERROR";
        message = "Database error";
      }
    } else if (pgCodeNum && pgCodeNum >= 400 && pgCodeNum < 600) {
      // Error with numeric status code property (from some libraries)
      statusCode = pgCodeNum;
      errorCode = (err as unknown as { type?: string }).type || "REQUEST_ERROR";
      message = err.message;
    } else if (
      err.message?.includes("not found") ||
      err.message?.includes("NOT_FOUND") ||
      err.message?.includes("does not exist")
    ) {
      statusCode = 404;
      errorCode = "NOT_FOUND";
      message = err.message;
    } else if (
      err.message?.includes("invalid") ||
      err.message?.includes("Invalid") ||
      err.message?.includes("validation")
    ) {
      statusCode = 400;
      errorCode = "VALIDATION_ERROR";
      message = err.message;
    }
  }

  // Log server errors, but not client errors (4xx)
  if (statusCode >= 500) {
    console.error(`[ERROR ${statusCode}] ${errorCode}: ${message}`, err.stack);
  } else if (statusCode >= 400) {
    console.warn(`[CLIENT ERROR ${statusCode}] ${errorCode}: ${message}`);
  }

  // Never leak internal DB details to client for 500 errors
  const clientMessage = statusCode >= 500 ? "An unexpected error occurred" : message;

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: clientMessage,
    },
  });
}
