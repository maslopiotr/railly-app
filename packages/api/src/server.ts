import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";

const PORT = process.env.API_PORT || 3000;

const app = express();

// Security & parsing middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// API routes
app.use("/api/v1", healthRouter);

// Health check at root too for convenience
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚂 Rail Buddy API running on port ${PORT}`);
});