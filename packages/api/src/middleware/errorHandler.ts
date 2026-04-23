import type { Request, Response, NextFunction } from "express";

/** Custom error class with HTTP status code */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Create a 400 Bad Request error */
export function badRequest(code: string, message: string): ApiError {
  return new ApiError(code, message, 400);
}

/** Create a 404 Not Found error */
export function notFound(code: string, message: string): ApiError {
  return new ApiError(code, message, 404);
}

/** Create a 429 Too Many Requests error */
export function tooManyRequests(code: string, message: string): ApiError {
  return new ApiError(code, message, 429);
}

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
  } else if ((err as Error).message?.includes("not found") || (err as Error).message?.includes("NOT_FOUND")) {
    // Heuristic for common not-found errors from DB or other layers
    statusCode = 404;
    errorCode = "NOT_FOUND";
    message = err.message;
  }

  // Log server errors, but not client errors (4xx)
  if (statusCode >= 500) {
    console.error(`[ERROR ${statusCode}] ${errorCode}: ${message}`, err.stack);
  } else if (statusCode >= 400) {
    console.warn(`[CLIENT ERROR ${statusCode}] ${errorCode}: ${message}`);
  }

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
    },
  });
}
