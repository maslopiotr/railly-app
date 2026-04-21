/**
 * Darwin Push Port: Station Message (OW) handler (P1)
 *
 * Station messages are alerts displayed on station departure boards.
 * We store them per-CRS for quick retrieval by the board API.
 */

import type { DarwinStationMessage } from "@railly-app/shared";
import { keys, TTL } from "../redis/client.js";
import type { ChainableCommander } from "ioredis";

/**
 * Process a station message: store in Redis per-CRS.
 */
export async function handleStationMessage(
  message: DarwinStationMessage,
  pipeline: ChainableCommander,
  generatedAt: string,
): Promise<void> {
  // Messages may target a CRS or be general (no CRS)
  const crsList: string[] = [];
  if (message.crs) {
    crsList.push(message.crs);
  } else {
    // General message — store under a global key
    crsList.push("_GLOBAL");
  }

  const payload = JSON.stringify({
    id: message.id,
    message: message.message,
    severity: message.severity || "0",
    category: message.category || "Misc",
    generatedAt,
  });

  for (const crs of crsList) {
    const msgKey = keys.stationMessages(crs);
    // Store as a hash keyed by message ID for deduplication
    pipeline.hset(msgKey, message.id, payload);
    pipeline.expire(msgKey, TTL.messages);
  }
}