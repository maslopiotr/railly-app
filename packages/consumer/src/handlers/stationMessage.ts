/**
 * Darwin Push Port: OW (Station Message) handler
 *
 * Processes station messages from the Darwin Push Port feed.
 * Each OW message has a unique `id` that is used for UPSERT — the same
 * message can be updated multiple times with changed content.
 *
 * Data flow:
 *   1. UPSERT station_messages row on message_id
 *   2. DELETE old station_message_stations rows for this message_id
 *   3. INSERT new station_message_stations rows from OW.Station array
 *
 * All three operations run in a transaction for atomicity.
 */

import { sql } from "../db.js";
import { log } from "../log.js";
import type { DarwinStationMessage } from "@railly-app/shared";

export async function handleStationMessage(
  ow: DarwinStationMessage,
  _generatedAt: string,
): Promise<void> {
  const messageId = ow.id;
  if (!messageId) {
    log.warn("   ⚠️ OW message missing id, skipping");
    return;
  }

  const message = ow.message ?? "";
  if (!message && !ow.Msg) {
    log.debug(`   📢 OW message ${messageId} has no text content, skipping`);
    return;
  }

  const category = ow.category ?? ow.cat ?? null;
  const severity =
    ow.severity !== undefined
      ? parseInt(String(ow.severity), 10)
      : ow.sev !== undefined
        ? parseInt(String(ow.sev), 10)
        : null;
  const suppress = ow.suppress ?? false;
  const messageRaw = ow.messageRaw ?? (ow.Msg ? JSON.stringify(ow.Msg) : null);
  const stations = ow.Station ?? [];

  await sql.begin(async (tx) => {
    // 1. UPSERT station_messages
    await tx`
      INSERT INTO station_messages (message_id, category, severity, suppress, message, message_raw, updated_at)
      VALUES (${messageId}, ${category}, ${severity}, ${suppress}, ${message}, ${messageRaw}, NOW())
      ON CONFLICT (message_id) DO UPDATE SET
        category = EXCLUDED.category,
        severity = EXCLUDED.severity,
        suppress = EXCLUDED.suppress,
        message = EXCLUDED.message,
        message_raw = EXCLUDED.message_raw,
        updated_at = NOW()
    `;

    // 2. DELETE old station links (will be replaced with current data)
    await tx`
      DELETE FROM station_message_stations WHERE message_id = ${messageId}
    `;

    // 3. INSERT new station links
    if (stations.length > 0) {
      for (const s of stations) {
        if (s.crs) {
          await tx`
            INSERT INTO station_message_stations (message_id, crs)
            VALUES (${messageId}, ${s.crs})
            ON CONFLICT (message_id, crs) DO NOTHING
          `;
        }
      }
    }
  });

  log.debug(
    `   📢 Station message ${messageId}: ${category ?? "no-cat"}/${severity ?? "no-sev"} — ${message.slice(0, 80)}${stations.length > 0 ? ` [${stations.map((s) => s.crs).join(",")}]` : ""}`,
  );
}