/**
 * Service details route — individual train service details
 *
 * Proxies requests to the LDBWS GetServiceDetails endpoint.
 * Note: This endpoint may not be available on all raildata.org.uk
 * subscriptions. The GetArrDepBoardWithDetails board endpoint already
 * includes calling points and formation data per service.
 */

import { Router } from "express";
import { getServiceDetails } from "../services/ldbws.js";

const router = Router();

/**
 * GET /api/v1/services/:serviceId
 *
 * Get full service details by service ID.
 * Returns complete calling pattern, formation, platform, etc.
 */
router.get("/:serviceId", async (req, res) => {
  try {
    const { serviceId } = req.params;

    if (!serviceId || serviceId.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: "INVALID_SERVICE_ID",
          message: "Service ID is required",
        },
      });
    }

    const details = await getServiceDetails(serviceId.trim());
    return res.json(details);
  } catch (err) {
    console.error("Service details fetch error:", err);

    if (err instanceof Error && err.message.includes("LDBWS auth failed")) {
      return res.status(502).json({
        error: {
          code: "UPSTREAM_AUTH_ERROR",
          message: "Failed to authenticate with the rail data provider",
        },
      });
    }

    if (err instanceof Error && err.message.includes("LDBWS API error")) {
      return res.status(502).json({
        error: {
          code: "UPSTREAM_ERROR",
          message: "Error from the rail data provider",
        },
      });
    }

    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch service details",
      },
    });
  }
});

export { router as servicesRouter };
