/**
 * Darwin Push Port: JSON message parser
 *
 * Parses Kafka STOMP envelope JSON, extracts the Darwin payload from the
 * `bytes` field, and normalises single objects into arrays so downstream
 * handlers always receive arrays.
 *
 * Returns a discriminated union `ParseResult` so callers can distinguish
 * between successful parses, expected skips, and genuine errors that
 * should be persisted to the `darwin_audit` table.
 */

import type { DarwinMessage } from "@railly-app/shared";
import { log } from "./log.js";

/**
 * Result of parsing a raw Kafka message.
 * - `success` — valid DarwinMessage ready for handler routing
 * - `skip`    — expected/normal skip (control message, metadata-only, empty input)
 * - `error`   — genuine parse failure; `code` and `message` should be persisted
 *               to `darwin_audit` for investigation
 */
export type ParseResult =
  | { kind: "success"; message: DarwinMessage }
  | { kind: "skip"; reason: string }
  | { kind: "error"; code: string; message: string; rawPreview: string; rawFull: string };

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
 * Returns a `ParseResult` discriminated union:
 * - `{ kind: "success", message }` — valid message, route to handlers
 * - `{ kind: "skip", reason }` — expected skip (null input, control message, metadata-only)
 * - `{ kind: "error", code, message, rawPreview }` — parse failure, persist to darwin_audit
 */
export function parseDarwinMessage(raw: Buffer | string | null): ParseResult {
  if (!raw) return { kind: "skip", reason: "empty input" };

   const rawText = Buffer.isBuffer(raw) ? raw.toString("utf-8") : raw;
   const rawPreview = rawText.length > 300 ? rawText.slice(0, 300) + "…" : rawText;
    // Store the full raw message for darwin_audit so we can debug parse failures
    const rawFull = rawText;

   let envelope: unknown;
   try {
     envelope = JSON.parse(rawText);
   } catch (parseErr) {
     const errMsg = `Failed to parse outer STOMP envelope JSON`;
      log.error(`   ❌ ${errMsg}`);
      log.error(`      Raw preview: ${rawPreview}`);
     return { kind: "error", code: "ENVELOPE_PARSE_ERROR", message: errMsg, rawPreview, rawFull };
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
    const envelopeKeys = typeof envelope === "object" && envelope !== null
      ? Object.keys(envelope as Record<string, unknown>).join(", ")
      : String(envelope);
    const errMsg = `Missing 'bytes' field in STOMP envelope (keys: [${envelopeKeys}])`;
    log.error(`   ❌ ${errMsg}`);
    return { kind: "error", code: "MISSING_BYTES_FIELD", message: errMsg, rawPreview, rawFull };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bytes as string);
  } catch {
    const bytesPreview = (bytes as string).length > 300 ? (bytes as string).slice(0, 300) + "…" : bytes;
    const errMsg = `Failed to parse Darwin payload JSON from bytes`;
    log.error(`   ❌ ${errMsg}`);
    log.error(`      Bytes preview: ${bytesPreview}`);
    return { kind: "error", code: "PAYLOAD_PARSE_ERROR", message: errMsg, rawPreview: bytesPreview as string, rawFull };
  }

  if (typeof payload !== "object" || payload === null) {
    const payloadType = payload === null ? "null" : typeof payload;
    const errMsg = `Darwin payload is not an object (type: ${payloadType})`;
    log.error(`   ❌ ${errMsg}`);
    return { kind: "error", code: "PAYLOAD_NOT_OBJECT", message: errMsg, rawPreview, rawFull };
  }

  const p = payload as Record<string, unknown>;

  // Top-level envelope fields
  const ts = typeof p.ts === "string" ? p.ts : undefined;
  const version = typeof p.version === "string" ? p.version : undefined;

  // Silently skip known control messages (heartbeat/status responses)
  for (const key of CONTROL_KEYS) {
    if (key in p) {
      return { kind: "skip", reason: `control message: ${key}` };
    }
  }

  // The data lives inside uR (update) or sR (snapshot)
  const dataBlock = p.uR ?? p.sR;
  if (typeof dataBlock !== "object" || dataBlock === null) {
    const payloadKeys = Object.keys(p).filter(k => k !== "ts" && k !== "version").join(", ");
    const hasUR = "uR" in p;
    const hasSR = "sR" in p;
    const urType = p.uR !== undefined ? typeof p.uR : "undefined";
    const srType = p.sR !== undefined ? typeof p.sR : "undefined";
    const errMsg = `Missing uR or sR data block (keys: [${payloadKeys}], hasUR: ${hasUR}, hasSR: ${hasSR}, urType: ${urType}, srType: ${srType})`;
    log.error(`   ❌ ${errMsg}`);
    return { kind: "error", code: "MISSING_DATA_BLOCK", message: errMsg, rawPreview, rawFull };
  }

  const d = dataBlock as Record<string, unknown>;

  // Silently skip empty uR/sR blocks that only contain metadata
  // (e.g. {"updateOrigin":"CIS","requestSource":"at10","requestID":"..."})
  const dataKeys = Object.keys(d);
  const hasOnlyMetadata = dataKeys.length > 0 && dataKeys.every((k) => METADATA_KEYS.has(k));
  if (hasOnlyMetadata) {
    return { kind: "skip", reason: `metadata-only: [${dataKeys.join(", ")}]` };
  }

  // Normalise each possible message type to an array
  const toArray = (v: unknown): unknown[] | undefined => {
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v];
    return undefined;
  };

  /**
   * Extract platform string and flags from Darwin's `plat` field.
   * Darwin sends `plat` as either:
   *   - a string: "plat": "6"
   *   - an object: "plat": {"platsup": "true", "platsrc": "A", "conf": "true", "": "2"}
   *
   * Darwin plat object attributes:
   *   platsup    — "true" if platform is suppressed from public display
   *   cisPlatsup — "true" if CIS has suppressed the platform
   *   platsrc    — "A" = from TIPLOC/train describer, "C" = CIS, "D" = Darwin
   *   conf       — "true" if platform is confirmed by train describer
   *   ""         — (empty key) the platform number string
   */
  const normalizePlatform = (loc: Record<string, unknown>): void => {
    const plat = loc.plat;
    if (plat === undefined) return;

    if (typeof plat === "string") {
      loc.platform = plat;
      loc.platIsSuppressed = false;
      loc.platSourcedFromTIPLOC = false;
      loc.confirmed = false;
    } else if (typeof plat === "object" && plat !== null) {
      const p = plat as Record<string, unknown>;
      // Platform value is in the empty-string key (e.g. {"": "2"})
      // Do NOT use conf as a fallback — conf is "true"/"false" for confirmation, not the platform number
      const platValue = p[""] !== undefined ? String(p[""]) : undefined;
      if (platValue && platValue !== "true" && platValue !== "false") {
        loc.platform = platValue;
      }
      loc.platIsSuppressed =
        p.platsup === "true" || p.cisPlatsup === "true";
      loc.platSourcedFromTIPLOC = p.platsrc === "A";
      // Darwin conf = "true" means platform confirmed by train describer
      loc.confirmed = p.conf === "true";
    }

    delete loc.plat;
  };

  /**
   * Convert Darwin string booleans to actual booleans.
   * Darwin sends "true"/"false" as strings; we need proper booleans.
   */
  const toBool = (v: unknown): boolean | undefined => {
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return undefined;
  };

  // Normalise nested arrays inside TS and schedule messages
  const normalizeTS = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const ts = item as Record<string, unknown>;

      // ── Service-level cancellation ────────────────────────────────
      // Darwin TS messages can have isCancelled at the top level
      if (ts.isCancelled !== undefined) {
        ts.isCancelled = toBool(ts.isCancelled) ?? false;
      }
      // Service-level lateReason/cancelReason
      if (ts.lateReason !== undefined) {
        const lr = ts.lateReason as Record<string, unknown>;
        if (lr) {
          ts.delayReason = lr;
          if (lr.reasontext !== undefined) ts.delayReasonText = String(lr.reasontext);
          if (lr.code !== undefined) ts.delayReasonCode = Number(lr.code);
        }
      }
      if (ts.cancelReason !== undefined) {
        const cr = ts.cancelReason as Record<string, unknown>;
        if (cr) {
          ts.cancelReason = cr;
          if (cr.reasontext !== undefined) ts.cancelReasonText = String(cr.reasontext);
          if (cr.code !== undefined) ts.cancelReasonCode = Number(cr.code);
        }
      }
      // Service-level isReverseFormation (string boolean → boolean)
      if (ts.isReverseFormation !== undefined) {
        ts.isReverseFormation = toBool(ts.isReverseFormation) ?? false;
      }

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
              log.warn("   ⚠️ TS location missing tpl (raw):", JSON.stringify(l).slice(0, 200));
            }
            // Convert string booleans for TS location fields
            if (l.cancelled !== undefined) l.cancelled = toBool(l.cancelled) ?? false;
            if (l.suppr !== undefined) l.suppr = toBool(l.suppr) ?? false;
            if (l.isOrigin !== undefined) l.isOrigin = toBool(l.isOrigin) ?? false;
            if (l.isDestination !== undefined) l.isDestination = toBool(l.isDestination) ?? false;
            if (l.isPass !== undefined) l.isPass = toBool(l.isPass) ?? false;

            normalizePlatform(l);

            // ── Extract from nested arr/dep/pass objects ────────────────────
            // Darwin TS messages nest estimates/actuals in sub-objects:
            //   arr: { et: "17:07", at: "17:05", src: "Darwin" }
            //   dep: { et: "17:08", at: "17:06", src: "Darwin" }
            //   pass: { et: "17:02", at: "17:05", src: "TD" }
            // These must be flattened to eta/etd/ata/atd for the handler.

            // Normalise time to HH:MM — Darwin sends HH:MM for public times,
            // but we truncate HH:MM:SS to HH:MM for consistency and storage
            const normaliseTime = (t: string | undefined): string | undefined => {
              if (!t) return undefined;
              const trimmed = t.trim();
              if (trimmed.length >= 5) return trimmed.slice(0, 5); // "HH:MM:SS" → "HH:MM"
              return trimmed || undefined;
            };

            // Extract arrival estimates/actuals from arr
            if (l.arr && typeof l.arr === "object") {
              const arr = l.arr as Record<string, unknown>;
              if (arr.et && typeof arr.et === "string" && arr.et.trim()) {
                l.eta = normaliseTime(arr.et);
              }
              if (arr.at && typeof arr.at === "string" && arr.at.trim()) {
                l.ata = normaliseTime(arr.at);
              }
              if (arr.wet && typeof arr.wet === "string" && arr.wet.trim()) {
                l.weta = normaliseTime(arr.wet);
              }
            }

            // Extract departure estimates/actuals from dep
            if (l.dep && typeof l.dep === "object") {
              const dep = l.dep as Record<string, unknown>;
              if (dep.et && typeof dep.et === "string" && dep.et.trim()) {
                l.etd = normaliseTime(dep.et);
              }
              if (dep.at && typeof dep.at === "string" && dep.at.trim()) {
                l.atd = normaliseTime(dep.at);
              }
              if (dep.wet && typeof dep.wet === "string" && dep.wet.trim()) {
                l.wetd = normaliseTime(dep.wet);
              }
            }

            // Extract passing estimates/actuals from pass
            // For PP locations, pass.et/pass.at are the only times available
            if (l.pass && typeof l.pass === "object") {
              const pass = l.pass as Record<string, unknown>;
              if (pass.et && typeof pass.et === "string" && pass.et.trim()) {
                if (!l.etd) l.etd = normaliseTime(pass.et);
              }
              if (pass.at && typeof pass.at === "string" && pass.at.trim()) {
                if (!l.atd) l.atd = normaliseTime(pass.at);
              }
              if (pass.wet && typeof pass.wet === "string" && pass.wet.trim()) {
                if (!l.wetd) l.wetd = normaliseTime(pass.wet);
              }
            }

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

      // ── Schedule-level cancellation ──────────────────────────────
      // Darwin sends can="true" (string) — convert to boolean
      if (sched.can !== undefined) {
        sched.can = toBool(sched.can) ?? false;
      }
      // Schedule-level isPassengerSvc (string boolean)
      // Only set to true/false when explicitly present; leave undefined when absent.
      // Darwin will correct via pushport updates if the attribute changes.
      if (sched.isPassengerSvc !== undefined) {
        sched.isPassengerSvc = toBool(sched.isPassengerSvc);
      }
      // Schedule-level deleted flag
      if (sched.deleted !== undefined) {
        sched.deleted = toBool(sched.deleted) ?? false;
      }
      // Schedule-level isActive (XSD default: true)
      if (sched.isActive !== undefined) {
        sched.isActive = toBool(sched.isActive) ?? true;
      }

      // Darwin schedule locations can be: OR, OPOR, IP, OPIP, PP (array), DT, OPDT
      // We need to collect them into a unified locations array with stopType.
      // OPOR/OPIP/OPDT are operational (non-passenger) variants that Darwin
      // sends as separate top-level keys — they were previously ignored, causing
      // VSTP services to lose their origin/destination data (BUG-024).
      if (!sched.locations && (sched.OR || sched.OPOR || sched.IP || sched.OPIP || sched.PP || sched.DT || sched.OPDT)) {
        const locations: unknown[] = [];
        if (sched.OR) {
          const orArray = Array.isArray(sched.OR) ? sched.OR : [sched.OR];
          for (const or of orArray) {
            (or as Record<string, unknown>).stopType = "OR";
            locations.push(or);
          }
        }
        if (sched.OPOR) {
          const oporArray = Array.isArray(sched.OPOR) ? sched.OPOR : [sched.OPOR];
          for (const opor of oporArray) {
            (opor as Record<string, unknown>).stopType = "OPOR";
            locations.push(opor);
          }
        }
        if (sched.IP) {
          const ipArray = Array.isArray(sched.IP) ? sched.IP : [sched.IP];
          for (const ip of ipArray) {
            (ip as Record<string, unknown>).stopType = "IP";
            locations.push(ip);
          }
        }
        if (sched.OPIP) {
          const opipArray = Array.isArray(sched.OPIP) ? sched.OPIP : [sched.OPIP];
          for (const opip of opipArray) {
            (opip as Record<string, unknown>).stopType = "OPIP";
            locations.push(opip);
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
          const dtArray = Array.isArray(sched.DT) ? sched.DT : [sched.DT];
          for (const dt of dtArray) {
            (dt as Record<string, unknown>).stopType = "DT";
            locations.push(dt);
          }
        }
        if (sched.OPDT) {
          const opdtArray = Array.isArray(sched.OPDT) ? sched.OPDT : [sched.OPDT];
          for (const opdt of opdtArray) {
            (opdt as Record<string, unknown>).stopType = "OPDT";
            locations.push(opdt);
          }
        }
        sched.locations = locations;
      }
      // Normalize platform fields inside each location
      if (Array.isArray(sched.locations)) {
        for (const loc of sched.locations) {
          if (typeof loc === "object" && loc !== null) {
            const l = loc as Record<string, unknown>;
            if (!l.tpl) {
              log.warn("   ⚠️ Schedule location missing tpl (raw):", JSON.stringify(l).slice(0, 200));
            }
            normalizePlatform(l);

            // ── Location-level boolean fields (Phase 1) ──────────────
            if (l.affectedByDiversion !== undefined) {
              l.affectedByDiversion = toBool(l.affectedByDiversion) ?? false;
            }
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

      // Ensure loading is always an array
      if (fl.loading !== undefined && !Array.isArray(fl.loading)) {
        fl.loading = [fl.loading];
      }

      // ── Extract empty-string key "" → loadingPercentage on each coach loading ──
      // Darwin JSON uses {"coachNumber":"1","":"15"} where "" holds the loading %
      if (Array.isArray(fl.loading)) {
        for (const coachEntry of fl.loading) {
          if (typeof coachEntry === "object" && coachEntry !== null) {
            const ce = coachEntry as Record<string, unknown>;
            // Extract the empty-string key value as loadingPercentage
            if (ce[""] !== undefined && ce.loadingPercentage === undefined) {
              ce.loadingPercentage = String(ce[""]);
              delete ce[""];
            }
          }
        }
      }

      return item;
    });
  };

  /**
   * Strip HTML tags and decode common entities from a Darwin OW message.
   * Darwin sends Msg as either a plain string or an HTML-like object:
   *   - "Msg": "Simple text"
   *   - "Msg": {"a": "https://...", "linktext": "Click here"}  (HTML anchor)
   *   - "Msg": {"p": "Some text"}                              (paragraph)
   *
   * We extract the plain text content, stripping tags and decoding entities.
   */
  const stripHtmlTags = (html: string): string => {
    return html
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Strip HTML tags
      .replace(/<[^>]*>/g, "")
      // Normalise whitespace
      .replace(/\s+/g, " ")
      .trim();
  };

  /**
   * Extract plain text from a Darwin OW Msg field.
   * Msg can be:
   *   - undefined/null  → no message
   *   - string          → plain text or HTML string
   *   - object          → HTML-like object (extract text values, join)
   */
  const extractOwMessageText = (msg: unknown): { message: string; messageRaw: string } | null => {
    if (msg === undefined || msg === null) return null;

    // Store raw JSON for debugging
    const messageRaw = JSON.stringify(msg);

    if (typeof msg === "string") {
      const message = stripHtmlTags(msg);
      return message ? { message, messageRaw } : null;
    }

    if (typeof msg === "object") {
      // HTML-like object: extract text content from values
      // e.g. {"a": "https://...", "linktext": "Click here"} → "Click here"
      // e.g. {"p": "Some text"} → "Some text"
      const obj = msg as Record<string, unknown>;
      const parts: string[] = [];
      for (const [, val] of Object.entries(obj)) {
        // Skip empty-string keys (Darwin uses "" for the primary content,
        // but for Msg it's usually named keys like "a", "p", etc.)
        if (typeof val === "string") {
          const stripped = stripHtmlTags(val);
          if (stripped) parts.push(stripped);
        }
      }
      const message = parts.join(" ").trim();
      return message ? { message, messageRaw } : null;
    }

    return null;
  };

  const normalizeOW = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const ow = item as Record<string, unknown>;

      // Ensure Station is always an array
      if (ow.Station !== undefined && !Array.isArray(ow.Station)) {
        ow.Station = [ow.Station];
      }

      // ── Msg → message / messageRaw ──────────────────────────────
      // Darwin OW Msg can be a plain string or HTML-like object.
      // Extract plain text into `message`, store original JSON in `messageRaw`.
      if (ow.Msg !== undefined && ow.message === undefined) {
        const extracted = extractOwMessageText(ow.Msg);
        if (extracted) {
          ow.message = extracted.message;
          ow.messageRaw = extracted.messageRaw;
        }
      }

      // ── suppress (string boolean → boolean) ─────────────────────
      if (ow.suppress !== undefined) {
        ow.suppress = toBool(ow.suppress) ?? false;
      }

      // ── Convenience aliases: category ← cat, severity ← sev ────
      // These duplicate the Darwin fields with clearer names for downstream use.
      if (ow.cat !== undefined && ow.category === undefined) {
        ow.category = ow.cat;
      }
      if (ow.sev !== undefined && ow.severity === undefined) {
        ow.severity = ow.sev;
      }

      return item;
    });
  };

  // ── Schedule Formations (P2) ──────────────────────────────────────────
  // Darwin JSON: { rid, formation: { fid, src, coaches: { coach: {...} | [...] } } }
  // Normalise: formation single object → array, coaches.coach single → array
  const normalizeScheduleFormations = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const sf = item as Record<string, unknown>;

      // Normalise formation: single object → array
      if (sf.formation !== undefined && !Array.isArray(sf.formation)) {
        sf.formation = [sf.formation];
      }

      // Normalise coaches.coach inside each formation
      if (Array.isArray(sf.formation)) {
        for (const f of sf.formation) {
          if (typeof f === "object" && f !== null) {
            const fm = f as Record<string, unknown>;
            if (fm.coaches && typeof fm.coaches === "object") {
              const coaches = fm.coaches as Record<string, unknown>;
              if (coaches.coach !== undefined && !Array.isArray(coaches.coach)) {
                coaches.coach = [coaches.coach];
              }
            }
          }
        }
      }

      return item;
    });
  };

  // ── Train Alert (P3) ──────────────────────────────────────────────────
  // Darwin JSON uses PascalCase keys from XML:
  //   { AlertID, AlertServices: { AlertService: { RID, UID, SSD, Location } },
  //     SendAlertBySMS, SendAlertByEmail, SendAlertByTwitter,
  //     Source, AlertText, Audience, AlertType }
  // Normalise: rename to camelCase, convert string booleans, normalise nested arrays
  const normalizeTrainAlert = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const raw = item as Record<string, unknown>;

      // AlertID → alertId
      if (raw.AlertID !== undefined) {
        raw.alertId = String(raw.AlertID);
        delete raw.AlertID;
      }

      // AlertServices → alertServices (with nested normalisation)
      if (raw.AlertServices !== undefined && typeof raw.AlertServices === "object" && raw.AlertServices !== null) {
        const as = raw.AlertServices as Record<string, unknown>;
        const alertServices: Record<string, unknown> = {};

        // Normalise AlertService: single → array
        if (as.AlertService !== undefined) {
          let alertServiceArray = Array.isArray(as.AlertService) ? as.AlertService : [as.AlertService];

          alertServiceArray = alertServiceArray.map((svc: unknown) => {
            if (typeof svc !== "object" || svc === null) return svc;
            const s = svc as Record<string, unknown>;
            if (s.RID !== undefined) { s.rid = String(s.RID); delete s.RID; }
            if (s.UID !== undefined) { s.uid = String(s.UID); delete s.UID; }
            if (s.SSD !== undefined) { s.ssd = String(s.SSD); delete s.SSD; }
            // Location → locations (normalise single → array)
            if (s.Location !== undefined) {
              s.locations = Array.isArray(s.Location) ? s.Location : [s.Location];
              delete s.Location;
            }
            return s;
          });

          alertServices.AlertService = alertServiceArray;
        }

        raw.alertServices = alertServices;
        delete raw.AlertServices;
      }

      // String booleans → boolean
      if (raw.SendAlertBySMS !== undefined) { raw.sendAlertBySMS = toBool(raw.SendAlertBySMS) ?? false; delete raw.SendAlertBySMS; }
      if (raw.SendAlertByEmail !== undefined) { raw.sendAlertByEmail = toBool(raw.SendAlertByEmail) ?? false; delete raw.SendAlertByEmail; }
      if (raw.SendAlertByTwitter !== undefined) { raw.sendAlertByTwitter = toBool(raw.SendAlertByTwitter) ?? false; delete raw.SendAlertByTwitter; }
      // Source → source
      if (raw.Source !== undefined) { raw.source = String(raw.Source); delete raw.Source; }
      // AlertText → alertText
      if (raw.AlertText !== undefined) { raw.alertText = String(raw.AlertText); delete raw.AlertText; }
      // Audience → audience
      if (raw.Audience !== undefined) { raw.audience = String(raw.Audience); delete raw.Audience; }
      // AlertType → alertType
      if (raw.AlertType !== undefined) { raw.alertType = String(raw.AlertType); delete raw.AlertType; }
      // CopiedFromAlertID → copiedFromAlertId
      if (raw.CopiedFromAlertID !== undefined) { raw.copiedFromAlertId = String(raw.CopiedFromAlertID); delete raw.CopiedFromAlertID; }
      // CopiedFromSource → copiedFromSource
      if (raw.CopiedFromSource !== undefined) { raw.copiedFromSource = String(raw.CopiedFromSource); delete raw.CopiedFromSource; }

      return item;
    });
  };

  // ── Train Order (P3) ──────────────────────────────────────────────────
  // Darwin JSON (XSD choice model):
  //   set: { tiploc, crs, platform, set: { first: { rid|trainID, ... }, second?, third? } }
  //   clear: { tiploc, crs, platform, clear: { rid } }
  // Normalise: extract set/clear into `order` field with discriminated union
  const normalizeTrainOrder = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const raw = item as Record<string, unknown>;

      if (raw.set !== undefined && typeof raw.set === "object" && raw.set !== null) {
        const setData = raw.set as Record<string, unknown>;
        raw.order = {
          action: "set",
          data: {
            first: setData.first,
            second: setData.second,
            third: setData.third,
          },
        };
        delete raw.set;
      } else if (raw.clear !== undefined) {
        raw.order = { action: "clear" };
        delete raw.clear;
      }

      return item;
    });
  };

  // ── Tracking ID (P3) ──────────────────────────────────────────────────
  // Darwin JSON: { area, berthId, incorrectTrainID, correctTrainID }
  // Normalise: group area+berthId into `berth` object
  const normalizeTrackingID = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const raw = item as Record<string, unknown>;

      if (raw.area !== undefined || raw.berthId !== undefined) {
        raw.berth = {
          area: raw.area !== undefined ? String(raw.area) : "",
          berthId: raw.berthId !== undefined ? String(raw.berthId) : "",
        };
        delete raw.area;
        delete raw.berthId;
      }

      return item;
    });
  };

  // ── Alarm (P3) ────────────────────────────────────────────────────────
  // Darwin JSON (XSD choice model):
  //   set: { set: { id, tdAreaFail?: { areaId }, tdFeedFail?: {}, tyrellFeedFail?: {} } }
  //   clear: { clear: { id } }
  // Normalise: extract set/clear into `action` field with discriminated union
  const normalizeAlarm = (items: unknown[]): unknown[] => {
    return items.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const raw = item as Record<string, unknown>;

      if (raw.set !== undefined && typeof raw.set === "object" && raw.set !== null) {
        const setData = raw.set as Record<string, unknown>;
        const id = String(setData.id ?? "");

        let alarmDetail: Record<string, unknown>;
        if (setData.tdAreaFail !== undefined) {
          const fail = setData.tdAreaFail as Record<string, unknown>;
          alarmDetail = { type: "tdAreaFail", areaId: String(fail?.areaId ?? "") };
        } else if (setData.tdFeedFail !== undefined) {
          alarmDetail = { type: "tdFeedFail" };
        } else if (setData.tyrellFeedFail !== undefined) {
          alarmDetail = { type: "tyrellFeedFail" };
        } else {
          alarmDetail = { type: "unknown" };
        }

        raw.action = { type: "set", data: { id, alarmDetail } };
        delete raw.set;
      } else if (raw.clear !== undefined && typeof raw.clear === "object" && raw.clear !== null) {
        const clearData = raw.clear as Record<string, unknown>;
        raw.action = { type: "clear", id: String(clearData.id ?? "") };
        delete raw.clear;
      }

      return item;
    });
  };

  let scheduleItems = toArray(d.schedule);
  let tsItems = toArray(d.TS);
  let formationLoadingItems = toArray(d.formationLoading);
  let owItems = toArray(d.OW);
  let scheduleFormationsItems = toArray(d.scheduleFormations);
  let trainAlertItems = toArray(d.trainAlert);
  let trainOrderItems = toArray(d.trainOrder);
  let trackingIDItems = toArray(d.trackingID);
  let alarmItems = toArray(d.alarm);

  if (scheduleItems) scheduleItems = normalizeSchedule(scheduleItems);
  if (tsItems) tsItems = normalizeTS(tsItems);
  if (formationLoadingItems) formationLoadingItems = normalizeFormationLoading(formationLoadingItems);
  if (owItems) owItems = normalizeOW(owItems);
  if (scheduleFormationsItems) scheduleFormationsItems = normalizeScheduleFormations(scheduleFormationsItems);
  if (trainAlertItems) trainAlertItems = normalizeTrainAlert(trainAlertItems);
  if (trainOrderItems) trainOrderItems = normalizeTrainOrder(trainOrderItems);
  if (trackingIDItems) trackingIDItems = normalizeTrackingID(trackingIDItems);
  if (alarmItems) alarmItems = normalizeAlarm(alarmItems);

  const message: DarwinMessage = {
    type: p.uR ? "uR" : "sR",
    ts: ts ?? "",
    version: version ?? "",
    schedule: scheduleItems as DarwinMessage["schedule"],
    TS: tsItems as DarwinMessage["TS"],
    deactivated: toArray(d.deactivated) as DarwinMessage["deactivated"],
    association: toArray(d.association) as DarwinMessage["association"],
    scheduleFormations: scheduleFormationsItems as DarwinMessage["scheduleFormations"],
    serviceLoading: toArray(d.serviceLoading) as DarwinMessage["serviceLoading"],
    formationLoading: formationLoadingItems as DarwinMessage["formationLoading"],
    OW: owItems as DarwinMessage["OW"],
    trainAlert: trainAlertItems as DarwinMessage["trainAlert"],
    trainOrder: trainOrderItems as DarwinMessage["trainOrder"],
    trackingID: trackingIDItems as DarwinMessage["trackingID"],
    alarm: alarmItems as DarwinMessage["alarm"],
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
    const dataBlockKeys = Object.keys(d).join(", ");
  const errMsg = `Darwin payload contains no recognised data types (keys: [${dataBlockKeys}], type: ${message.type}, ts: ${ts ?? "none"})`;
  log.error(`   ❌ ${errMsg}`);
    return { kind: "error", code: "NO_DATA_TYPES", message: errMsg, rawPreview, rawFull };
  }

  return { kind: "success", message };
}