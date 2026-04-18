import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { healthRouter } from "./routes/health.js";
import { stationsRouter } from "./routes/stations.js";
import { errorHandler } from "./middleware/errorHandler.js";

const PORT = process.env.API_PORT || 3000;
const isDev = process.env.NODE_ENV !== "production";

const app = express();

// Security & parsing middleware
app.use(helmet());

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

// Health check at root too for convenience
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚂 Rail Buddy API running on port ${PORT}`);
});