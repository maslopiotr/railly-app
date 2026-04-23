import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { healthRouter } from "./routes/health.js";
import { stationsRouter } from "./routes/stations.js";
import { boardsRouter } from "./routes/boards.js";
import { servicesRouter } from "./routes/services.js";
import { timetableRouter } from "./routes/timetable.js";
import { errorHandler } from "./middleware/errorHandler.js";

const PORT = process.env.API_PORT || 3000;
const isDev = process.env.NODE_ENV !== "production";

const app = express();

// Trust the nginx proxy so rate limiting uses real client IP
// Only trust a single proxy layer (nginx in frontend container)
if (!isDev) {
  app.set("trust proxy", 1);
}

// Security & parsing middleware
app.use(helmet({
  frameguard: { action: "deny" },  // X-Frame-Options: DENY (more restrictive than SAMEORIGIN)
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// Request timeout — abort requests that take too long (prevents slowloris-style attacks)
app.use((_req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: { code: "TIMEOUT", message: "Request timed out" } });
    }
  });
  next();
});

// CORS — restrict origins in production, open in dev
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : isDev
    ? ["http://localhost:5173", "http://127.0.0.1:5173"]
    : [];

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: false,
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Accept"],
    maxAge: 86400, // preflight cache 24h
  }),
);

// Body size limit — prevent oversized payload DoS
app.use(express.json({ limit: "10kb" }));

// Rate limiting — 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    },
  },
});
app.use(limiter);

// API routes
app.use("/api/v1", healthRouter);
app.use("/api/v1/stations", stationsRouter);
app.use("/api/v1/stations", boardsRouter);
app.use("/api/v1/stations", timetableRouter);
app.use("/api/v1/services", servicesRouter);
app.use("/api/v1/journeys", timetableRouter);

// Health check at root too for convenience
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

app.listen(PORT, () => {
  console.log(
    `[${new Date().toISOString()}] [PID:${process.pid}] 🚂 Rail Buddy API running on port ${PORT}`,
  );
});
