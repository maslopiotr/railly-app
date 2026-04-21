/**
 * Darwin Push Port: JSON message parser
 *
 * Parses Kafka STOMP envelope JSON, extracts the Darwin payload from the
 * `bytes` field, and normalises single objects into arrays so downstream
 * handlers always receive arrays.
 */

import type { DarwinMessage } from "@railly-app/shared";

/**
 * Parse a raw Kafka message value into a DarwinMessage.
 * Handles the STOMP envelope wrapper that Confluent Cloud delivers.
 */
export function parseDarwinMessage(raw: Buffer | string | null): DarwinMessage | null {
  if (!raw) return null;

  let envelope: unknown;
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf-8") : raw;
    envelope = JSON.parse(text);
  } catch {
    console.error("   ❌ Failed to parse outer STOMP envelope JSON");
    return null;
  }

  // The real Darwin payload is a JSON string inside envelope.bytes
  const bytes =
    typeof envelope === "object" &&
    envelope !== null &&
    "bytes" in envelope &&
    typeof (envelope as Record<string, unknown>).bytes === "string"
      ? (envelope as Record<string, unknown>).bytes
      : null;

  if (!bytes) {
    console.error("   ❌ Missing 'bytes' field in STOMP envelope");
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bytes as string);
  } catch {
    console.error("   ❌ Failed to parse Darwin payload JSON from bytes");
    return null;
  }

  if (typeof payload !== "object" || payload === null) {
    console.error("   ❌ Darwin payload is not an object");
    return null;
  }

  const p = payload as Record<string, unknown>;

  // Top-level envelope fields
  const ts = typeof p.ts === "string" ? p.ts : undefined;
  const version = typeof p.version === "string" ? p.version : undefined;

  // The data lives inside uR (update) or sR (snapshot)
  const dataBlock = p.uR ?? p.sR;
  if (typeof dataBlock !== "object" || dataBlock === null) {
    console.error("   ❌ Missing uR or sR data block in Darwin payload");
    return null;
  }

  const d = dataBlock as Record<string, unknown>;

  // Normalise each possible message type to an array
  const toArray = (v: unknown): unknown[] | undefined => {
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v];
    return undefined;
  };

  const message: DarwinMessage = {
    type: p.uR ? "uR" : "sR",
    ts: ts ?? "",
    version,
    schedule: toArray(d.schedule) as DarwinMessage["schedule"],
    TS: toArray(d.TS) as DarwinMessage["TS"],
    deactivated: toArray(d.deactivated) as DarwinMessage["deactivated"],
    association: toArray(d.association) as DarwinMessage["association"],
    scheduleFormations: toArray(d.scheduleFormations) as DarwinMessage["scheduleFormations"],
    serviceLoading: toArray(d.serviceLoading) as DarwinMessage["serviceLoading"],
    formationLoading: toArray(d.formationLoading) as DarwinMessage["formationLoading"],
    OW: toArray(d.OW) as DarwinMessage["OW"],
    trainAlert: toArray(d.trainAlert) as DarwinMessage["trainAlert"],
    trainOrder: toArray(d.trainOrder) as DarwinMessage["trainOrder"],
    trackingID: toArray(d.trackingID) as DarwinMessage["trackingID"],
    alarm: toArray(d.alarm) as DarwinMessage["alarm"],
  };

  // Must have at least one data array
  const hasData =
    message.schedule ||
    message.TS ||
    message.deactivated ||
    message.association ||
    message.scheduleFormations ||
    message.serviceLoading ||
    message.formationLoading ||
    message.OW ||
    message.trainAlert ||
    message.trainOrder ||
    message.trackingID ||
    message.alarm;

  if (!hasData) {
    console.error("   ❌ Darwin payload contains no recognised data types");
    return null;
  }

  return message;
}
