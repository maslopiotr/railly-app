import { Router } from "express";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      database: "disconnected",
      redis: "disconnected",
    },
  });
});

export const healthRouter = router;