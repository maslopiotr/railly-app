/**
 * Darwin Push Port: JSON message parser
 *
 * Parses Kafka STOMP envelope JSON, extracts the Darwin payload from the
 * `bytes` field, and normalises single objects into arrays so downstream
 * handlers always receive arrays.
 */

import type { DarwinMessage } from "@railly-app/shared";

/**
 * Control messages that contain no train data and should be silently skipped.
 */
const CONTROL_KEYS = ["FailureResp"];

/**
 * Metadata-only keys inside uR/sR that do not constitute data.
 */
const METADATA_KEYS = new Set(["updateOrigin", "requestSource", "requestID"]);

/**
 * Parse a raw Kafka message value into a DarwinMessage.
 * Handles the STOMP envelope wrapper that Confluent Cloud delivers.
 *
 * Returns null for:
 * - Malformed JSON or missing fields (logged as errors)
 * - Known control messages like FailureResp (silently skipped)
 * - Empty uR blocks with only metadata like updateOrigin (silently skipped)
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

  // Silently skip known control messages (heartbeat/status responses)
  for (const key of CONTROL_KEYS) {
    if (key in p) {
      return null; // No error log — this is expected
    }
  }

  // The data lives inside uR (update) or sR (snapshot)
  const dataBlock = p.uR ?? p.sR;
  if (typeof dataBlock !== "object" || dataBlock === null) {
    console.error("   ❌ Missing uR or sR data block in Darwin payload");
    return null;
  }

  const d = dataBlock as Record<string, unknown>;

  // Silently skip empty uR/sR blocks that only contain metadata
  // (e.g. {"updateOrigin":"CIS","requestSource":"at10","requestID":"..."})
  const dataKeys = Object.keys(d);
  const hasOnlyMetadata = dataKeys.length > 0 && dataKeys.every((k) => METADATA_KEYS.has(k));
  if (hasOnlyMetadata) {
    return null; // No error log — CIS sync markers are expected
  }

  // Normalise each possible message type to an array
  const toArray = (v: unknown): unknown[] | undefined => {
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v];
    return undefined;
  };

  /**
   * Extract platform string and suppression flags from Darwin's `plat` field.
   * Darwin sends `plat` as either:
   *   - a string: "plat": "6"
   *   - an object: "plat": {"platsup": "true", "platsrc": "A", "conf": "true", "": "2"}
   */
  const normalizePlatform = (loc: Record<string, unknown>): void => {
    const plat = loc.plat;
    if (plat === undefined) return;

    if (typeof plat === "string") {
      loc.platform = plat;
      loc.platIsSuppressed = false;
    } else if (typeof plat === "object" && plat !== null) {
      const p = plat as Record<string, unknown>;
      // Platform value is in the empty-string key or the "conf" field
      const platValue =
        p[""] !== undefined
          ? String(p[""])
          : p.conf !== undefined && p.platsrc
            ? String(p.conf)
            : undefined;
      if (platValue) {
        loc.platform = platValue;
      }
      loc.platIsSuppressed =
        p.platsup === "true" || p.cisPlatsup === "true";
      loc.platSourcedFromTIPLOC = p.platsrc === "A";
      loc.platformIsChanged = p.conf === "true";
    }

    delete loc.plat;
  };

  // Normalise nested arrays inside TS and schedule messages
  const normalizeTS = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const ts = item as Record<string, unknown>;
      if (ts.Location !== undefined && !Array.isArray(ts.Location)) {
        ts.Location = [ts.Location];
      }
      // Rename Location → locations to match our DarwinTS type
      if (ts.Location !== undefined) {
        ts.locations = ts.Location;
        delete ts.Location;
      }
      // Normalize platform fields inside each location
      if (Array.isArray(ts.locations)) {
        for (const loc of ts.locations) {
          if (typeof loc === "object" && loc !== null) {
            const l = loc as Record<string, unknown>;
            if (!l.tpl) {
              console.warn("   ⚠️ TS location missing tpl (raw):", JSON.stringify(l).slice(0, 200));
            }
            normalizePlatform(l);

            // Map Darwin's generic `et` field to the correct specific field.
            // Darwin sends `et` when the location only has one meaningful time.
            // Use isPass/isOrigin/isDestination to determine which:
            //   - isPass=true OR (isOrigin=true AND isDestination!=true) → et is a departure (etd)
            //   - isDestination=true AND isOrigin!=true → et is an arrival (eta)
            //   - Otherwise, if both pta/wta and ptd/wtd exist, keep et as fallback for both
            if (l.et !== undefined && l.et !== null) {
              const etVal = String(l.et).trim();
              if (etVal) {
                const isPass = l.isPass === true;
                const isOrigin = l.isOrigin === true;
                const isDest = l.isDestination === true;
                if (isPass || (isOrigin && !isDest)) {
                  if (!l.etd) l.etd = etVal;
                } else if (isDest && !isOrigin) {
                  if (!l.eta) l.eta = etVal;
                } else {
                  // Fallback: apply to whichever is missing
                  if (!l.etd) l.etd = etVal;
                  if (!l.eta) l.eta = etVal;
                }
                // Do NOT delete l.et — keep it for reference
              }
            }

            // Extract lateReason from TS location
            if (l.lateReason !== undefined) {
              const lr = l.lateReason as Record<string, unknown>;
              if (lr?.reasontext !== undefined) {
                l.delayReason = String(lr.reasontext);
              } else if (lr?.code !== undefined) {
                l.delayReason = String(lr.code);
              }
            }
          }
        }
      }
      return item;
    });
  };

  const normalizeSchedule = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const sched = item as Record<string, unknown>;
      // Darwin schedule locations can be: OR, IP (array), PP (array), DT
      // We need to collect them into a unified locations array with stopType
      if (!sched.locations && (sched.OR || sched.IP || sched.PP || sched.DT)) {
        const locations: unknown[] = [];
        if (sched.OR) {
          const or = sched.OR as Record<string, unknown>;
          or.stopType = "OR";
          locations.push(or);
        }
        if (sched.IP) {
          const ipArray = Array.isArray(sched.IP) ? sched.IP : [sched.IP];
          for (const ip of ipArray) {
            (ip as Record<string, unknown>).stopType = "IP";
            locations.push(ip);
          }
        }
        if (sched.PP) {
          const ppArray = Array.isArray(sched.PP) ? sched.PP : [sched.PP];
          for (const pp of ppArray) {
            (pp as Record<string, unknown>).stopType = "PP";
            locations.push(pp);
          }
        }
        if (sched.DT) {
          const dt = sched.DT as Record<string, unknown>;
          dt.stopType = "DT";
          locations.push(dt);
        }
        sched.locations = locations;
      }
      // Normalize platform fields inside each location
      if (Array.isArray(sched.locations)) {
        for (const loc of sched.locations) {
          if (typeof loc === "object" && loc !== null) {
            const l = loc as Record<string, unknown>;
            if (!l.tpl) {
              console.warn("   ⚠️ Schedule location missing tpl (raw):", JSON.stringify(l).slice(0, 200));
            }
            normalizePlatform(l);
          }
        }
      }
      return item;
    });
  };

  const normalizeFormationLoading = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const fl = item as Record<string, unknown>;
      if (fl.loading !== undefined && !Array.isArray(fl.loading)) {
        fl.loading = [fl.loading];
      }
      return item;
    });
  };

  const normalizeOW = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const ow = item as Record<string, unknown>;
      // Ensure Station is always an array
      if (ow.Station !== undefined && !Array.isArray(ow.Station)) {
        ow.Station = [ow.Station];
      }
      return item;
    });
  };

  let scheduleItems = toArray(d.schedule);
  let tsItems = toArray(d.TS);
  let formationLoadingItems = toArray(d.formationLoading);
  let owItems = toArray(d.OW);

  if (scheduleItems) scheduleItems = normalizeSchedule(scheduleItems);
  if (tsItems) tsItems = normalizeTS(tsItems);
  if (formationLoadingItems) formationLoadingItems = normalizeFormationLoading(formationLoadingItems);
  if (owItems) owItems = normalizeOW(owItems);

  const message: DarwinMessage = {
    type: p.uR ? "uR" : "sR",
    ts: ts ?? "",
    version: version ?? "",
    schedule: scheduleItems as DarwinMessage["schedule"],
    TS: tsItems as DarwinMessage["TS"],
    deactivated: toArray(d.deactivated) as DarwinMessage["deactivated"],
    association: toArray(d.association) as DarwinMessage["association"],
    scheduleFormations: toArray(d.scheduleFormations) as DarwinMessage["scheduleFormations"],
    serviceLoading: toArray(d.serviceLoading) as DarwinMessage["serviceLoading"],
    formationLoading: formationLoadingItems as DarwinMessage["formationLoading"],
    OW: owItems as DarwinMessage["OW"],
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