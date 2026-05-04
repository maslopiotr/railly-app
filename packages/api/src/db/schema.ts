import {
  pgTable,
  serial,
  varchar,
  char,
  integer,
  smallint,
  timestamp,
  index,
  uniqueIndex,
  boolean,
  text,
} from "drizzle-orm/pg-core";

/**
 * Stations table — seeded from CORPUS reference data
 * CRS = 3-alpha station code (e.g. "KGX")
 * TIPLOC = Timing Point Location code (e.g. "KNGX")
 * STANOX = Station number (used in train movement messages)
 */
export const stations = pgTable(
  "stations",
  {
    id: serial("id").primaryKey(),
    crs: char("crs", { length: 3 }).notNull().unique(),
    tiploc: varchar("tiploc", { length: 10 }),
    stanox: varchar("stanox", { length: 10 }),
    name: varchar("name", { length: 255 }).notNull(),
    nlc: integer("nlc"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_stations_crs").on(table.crs),
    index("idx_stations_name").on(table.name),
    index("idx_stations_tiploc").on(table.tiploc),
  ],
);

/**
 * Timetable journeys — seeded from PPTimetable data
 * Each Journey has a unique RID (Retail Identifier) and contains
 * scheduled times, booked platforms, and calling patterns.
 */
export const journeys = pgTable(
  "journeys",
  {
    rid: varchar("rid", { length: 20 }).primaryKey(),
    uid: char("uid", { length: 6 }).notNull(),
    trainId: varchar("train_id", { length: 10 }),
    ssd: char("ssd", { length: 10 }).notNull(), // Schedule start date, e.g. "2026-04-19"
    toc: char("toc", { length: 2 }), // Train Operating Company code
    trainCat: varchar("train_cat", { length: 5 }), // e.g. "XX", "OO", "BR"
    status: char("status", { length: 1 }), // "P" = permanent, etc.
    isPassenger: boolean("is_passenger"), // Nullable: true = passenger, false = non-passenger, null = unknown (awaiting Darwin correction)
    sourceTimetable: boolean("source_timetable").default(false).notNull(),
    sourceDarwin: boolean("source_darwin").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_journeys_uid_ssd").on(table.uid, table.ssd),
    index("idx_journeys_toc").on(table.toc),
    index("idx_journeys_ssd").on(table.ssd),
    index("idx_journeys_ssd_passenger").on(table.ssd, table.isPassenger),
  ],
);

/**
 * Calling points within a journey — stops, passes, origins, destinations
 * Stop types: OR (origin), DT (destination), IP (intermediate),
 * PP (passing point), OPOR/OPIP/OPDT (operational variants in v8)
 *
 * Real-time columns (eta/etd/ata/atd/livePlat/etc.) are updated by the
 * Darwin Push Port consumer. Static columns (pta/ptd/plat/etc.) are
 * updated by the daily PP Timetable seed — seed uses ON CONFLICT UPDATE
 * to preserve real-time columns.
 */
export const callingPoints = pgTable(
  "calling_points",
  {
    id: serial("id").primaryKey(),
    journeyRid: varchar("journey_rid", { length: 20 })
      .notNull()
      .references(() => journeys.rid, { onDelete: "cascade" }),
    sortTime: char("sort_time", { length: 5 }).notNull(), // Natural key ordering: timetable-derived time (HH:MM)
    ssd: char("ssd", { length: 10 }), // Denormalised from journeys for direct querying
    stopType: varchar("stop_type", { length: 5 }).notNull(), // OR, DT, IP, PP, OPOR, OPIP, OPDT
    tpl: varchar("tpl", { length: 10 }).notNull(), // TIPLOC code
    crs: char("crs", { length: 3 }), // CRS code (from location_ref lookup)
    name: varchar("name", { length: 255 }), // Location name (denormalized from location_ref)
    sourceTimetable: boolean("source_timetable").default(false).notNull(), // Has PPTimetable data
    sourceDarwin: boolean("source_darwin").default(false).notNull(), // Has Darwin data
    // -- Timetable columns (PPTimetable only, seeded daily) --
    platTimetable: varchar("plat_timetable", { length: 5 }), // Booked platform
    ptaTimetable: char("pta_timetable", { length: 5 }), // Public arrival time HH:MM
    ptdTimetable: char("ptd_timetable", { length: 5 }), // Public departure time HH:MM
    wtaTimetable: varchar("wta_timetable", { length: 8 }), // Working arrival time
    wtdTimetable: varchar("wtd_timetable", { length: 8 }), // Working departure time
    wtpTimetable: varchar("wtp_timetable", { length: 8 }), // Working passing time
    act: varchar("act", { length: 10 }), // Activities (TB, TF, T, etc.)
    dayOffset: integer("day_offset").default(0).notNull(), // 0=same day as ssd, 1=next day, 2=day after
    // -- Push Port columns (Darwin only, updated live) --
    etaPushport: char("eta_pushport", { length: 5 }), // Estimated arrival HH:MM
    etdPushport: char("etd_pushport", { length: 5 }), // Estimated departure HH:MM
    ataPushport: char("ata_pushport", { length: 5 }), // Actual arrival HH:MM
    atdPushport: char("atd_pushport", { length: 5 }), // Actual departure HH:MM
    wetaPushport: char("weta_pushport", { length: 5 }), // Working estimated arrival HH:MM (from arr.wet)
    wetdPushport: char("wetd_pushport", { length: 5 }), // Working estimated departure HH:MM (from dep.wet)
    platPushport: varchar("plat_pushport", { length: 5 }), // Live platform from Darwin
    platSource: varchar("plat_source", { length: 10 }), // confirmed/altered/suppressed/etc (derived)
    platConfirmed: boolean("plat_confirmed").default(false).notNull(), // Platform confirmed by train describer (Darwin conf)
    platFromTd: boolean("plat_from_td").default(false).notNull(), // Platform sourced from TIPLOC/train describer (Darwin platsrc="A")
    isCancelled: boolean("is_cancelled").default(false).notNull(),
    delayMinutes: integer("delay_minutes"), // Computed delay vs scheduled
    delayReason: varchar("delay_reason", { length: 100 }), // Per-location delay reason from TS
    cancelReason: varchar("cancel_reason", { length: 100 }), // Per-location cancel reason from schedule
    platIsSuppressed: boolean("plat_is_suppressed").default(false).notNull(),
    suppr: boolean("suppr").default(false).notNull(), // Stop suppressed from public display entirely
    lengthPushport: varchar("length_pushport", { length: 10 }), // Train length in coaches
    detachFront: boolean("detach_front").default(false).notNull(), // Front coaches detach at this stop
    // -- Delay/uncertainty flags from Darwin arr/dep sub-objects --
    etaDelayed: boolean("eta_delayed").default(false).notNull(), // arr.delayed — show "Delayed" instead of ETA
    etdDelayed: boolean("etd_delayed").default(false).notNull(), // dep.delayed — show "Delayed" instead of ETD
    etaUnknownDelay: boolean("eta_unknown_delay").default(false).notNull(), // arr.etUnknown — unknown delay forecast
    etdUnknownDelay: boolean("etd_unknown_delay").default(false).notNull(), // dep.etUnknown — unknown delay forecast
    etaMin: char("eta_min", { length: 5 }), // arr.etmin — lower bound on estimated arrival HH:MM
    etdMin: char("etd_min", { length: 5 }), // dep.etmin — lower bound on estimated departure HH:MM
    isDeleted: boolean("is_deleted").default(false).notNull(), // Belongs to a deleted service
    // -- Loading columns (Darwin serviceLoading messages) --
    loadingPercentage: integer("loading_percentage"), // 0-100 from serviceLoading
    loadingPercentageType: varchar("loading_percentage_type", { length: 10 }), // "Typical" | "Expected"
    loadingPercentageSrc: varchar("loading_percentage_src", { length: 20 }), // e.g. "Darwin", "CIS"
    loadingPercentageSrcInst: varchar("loading_percentage_src_inst", { length: 20 }), // e.g. "at08"
    loadingCategory: varchar("loading_category", { length: 10 }), // Category code (not observed in live data yet)
    loadingCategoryType: varchar("loading_category_type", { length: 10 }),
    loadingCategorySrc: varchar("loading_category_src", { length: 20 }),
    loadingCategorySrcInst: varchar("loading_category_src_inst", { length: 20 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }), // Last Darwin message
    tsGeneratedAt: timestamp("ts_generated_at", { withTimezone: true }), // Last TS message timestamp (for dedup)
    timetableUpdatedAt: timestamp("timetable_updated_at", { withTimezone: true }), // Last PPTimetable seed update
  },
  (table) => [
    index("idx_calling_points_journey_rid").on(table.journeyRid),
    index("idx_calling_points_crs").on(table.crs),
    index("idx_calling_points_tpl").on(table.tpl),
    // Natural key unique index — replaces old sequence-based index (which was dropped)
    // Includes stop_type to handle PP+IP at same TIPLOC/time (e.g., WOKING vs WOKINGJ)
    uniqueIndex("idx_calling_points_natural").on(
      table.journeyRid,
      table.tpl,
      table.dayOffset,
      table.sortTime,
      table.stopType,
    ),
    // Composite indexes for board query patterns
    // Board query uses (crs, ssd) — composite index replaces separate crs + ssd indexes for this pattern
    index("idx_calling_points_crs_ssd").on(table.crs, table.ssd),
    index("idx_calling_points_journey_rid_stop_type").on(
      table.journeyRid,
      table.stopType,
    ),
    // Index for direct date querying
    index("idx_calling_points_ssd").on(table.ssd),
  ],
);

/**
 * Service real-time state — current snapshot per RID
 * Updated by the Darwin Push Port consumer on every TS/schedule message.
 * This table provides a quick lookup for service-level state without
 * scanning calling_points.
 */
export const serviceRt = pgTable(
  "service_rt",
  {
    rid: varchar("rid", { length: 20 }).primaryKey(),
    uid: char("uid", { length: 6 }).notNull(),
    ssd: char("ssd", { length: 10 }).notNull(),
    trainId: varchar("train_id", { length: 10 }),
    toc: char("toc", { length: 2 }),
    isCancelled: boolean("is_cancelled").default(false).notNull(),
    cancelReason: varchar("cancel_reason", { length: 100 }),
    delayReason: varchar("delay_reason", { length: 100 }),
    platform: varchar("platform", { length: 5 }), // Live platform at origin/head
    sourceTimetable: boolean("source_timetable").default(false).notNull(),
    sourceDarwin: boolean("source_darwin").default(false).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }), // Schedule message timestamp (for schedule dedup)
    tsGeneratedAt: timestamp("ts_generated_at", { withTimezone: true }), // TS message timestamp (for TS dedup)
    lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
    isDeleted: boolean("is_deleted").default(false).notNull(), // Service explicitly deleted from Darwin schedule
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }), // When Darwin removed this from active set
  },
  (table) => [
    index("idx_service_rt_rid").on(table.rid),
    index("idx_service_rt_last_updated").on(table.lastUpdated),
  ],
);

/**
 * Darwin events — append-only audit log of every Push Port message
 * Used for delay repay history, debugging, and replay.
 * Partitioned by day; old partitions dropped after retention period.
 */
export const darwinEvents = pgTable(
  "darwin_events",
  {
    id: serial("id").primaryKey(),
    messageType: varchar("message_type", { length: 20 }).notNull(), // TS, schedule, deactivated, OW, etc.
    rid: varchar("rid", { length: 20 }), // Nullable — some message types (formationLoading) have no RID
    rawJson: text("raw_json"), // Full raw message (TEXT to avoid truncation)
    generatedAt: timestamp("generated_at", { withTimezone: true }), // From Darwin message
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }), // When consumer finished
  },
  (table) => [
    index("idx_darwin_events_rid").on(table.rid),
    index("idx_darwin_events_message_type").on(table.messageType),
    index("idx_darwin_events_received_at").on(table.receivedAt),
  ],
);

/**
 * Darwin audit — structured log of every consumer failure, skip, or warning
 * Severity levels: error (exception), skip (intentionally skipped), warning (processed with issues)
 * Used for debugging, replay, and alerting.
 */
export const darwinAudit = pgTable(
  "darwin_audit",
  {
    id: serial("id").primaryKey(),
    messageType: varchar("message_type", { length: 20 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull().default("error"), // error, skip, warning
    rid: varchar("rid", { length: 20 }),
    errorCode: varchar("error_code", { length: 100 }), // e.g. "MISSING_RID", "MISSING_TPL", "PARSE_ERROR"
    errorMessage: text("error_message"), // Human-readable description
    rawJson: text("raw_json"), // Full message that caused the issue
    stackTrace: text("stack_trace"), // First 2000 chars of stack (errors only)
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }), // When fixed (null = unresolved)
    retryCount: integer("retry_count").default(0),
  },
  (table) => [
    index("idx_darwin_audit_rid").on(table.rid),
    index("idx_darwin_audit_message_type").on(table.messageType),
    index("idx_darwin_audit_received_at").on(table.receivedAt),
    index("idx_darwin_audit_error_code").on(table.errorCode),
    index("idx_darwin_audit_resolved_at").on(table.resolvedAt),
    index("idx_darwin_audit_severity").on(table.severity),
  ],
);

/**
 * TOC reference data — maps operator codes to names
 * Seeded from PPTimetable reference files
 */
export const tocRef = pgTable("toc_ref", {
  toc: char("toc", { length: 2 }).primaryKey(),
  tocName: varchar("toc_name", { length: 100 }).notNull(),
  url: varchar("url", { length: 255 }),
});

/**
 * Location reference — maps TIPLOC codes to CRS codes and names
 * Essential for resolving v4-v7 "ftl" (padded TIPLOC) to station CRS codes
 */
export const locationRef = pgTable(
  "location_ref",
  {
    tpl: varchar("tpl", { length: 10 }).primaryKey(), // TIPLOC code
    crs: char("crs", { length: 3 }), // CRS code (nullable — not all TIPLOCs have CRS)
    name: varchar("name", { length: 255 }), // Location name
    toc: char("toc", { length: 2 }), // Default TOC at this location
  },
  (table) => [index("idx_location_ref_crs").on(table.crs)],
);

/** Type for inserting a station row */
export type NewStation = typeof stations.$inferInsert;
/** Type for a station row as read from the DB */
export type StationRow = typeof stations.$inferSelect;
/** Type for inserting a journey row */
export type NewJourney = typeof journeys.$inferInsert;
/** Type for inserting a calling point row */
export type NewCallingPoint = typeof callingPoints.$inferInsert;
/** Type for inserting a TOC reference row */
export type NewTocRef = typeof tocRef.$inferInsert;
/** Type for inserting a location reference row */
export type NewLocationRef = typeof locationRef.$inferInsert;
/** Type for inserting a service_rt row */
export type NewServiceRt = typeof serviceRt.$inferInsert;
/** Type for a service_rt row as read from the DB */
export type ServiceRtRow = typeof serviceRt.$inferSelect;
/** Type for inserting a darwin_audit row */
export type NewDarwinAudit = typeof darwinAudit.$inferInsert;

/**
 * Skipped locations — TIPLOCs that were in a Darwin TS message but had no
 * matching calling point in the timetable. Used for data quality investigation.
 */
export const skippedLocations = pgTable(
  "skipped_locations",
  {
    id: serial("id").primaryKey(),
    rid: varchar("rid", { length: 20 }).notNull(), // Service RID
    tpl: varchar("tpl", { length: 10 }).notNull(), // TIPLOC code that was skipped
    ssd: char("ssd", { length: 10 }), // Service start date
    reason: varchar("reason", { length: 255 }), // Why it was skipped
    tsGeneratedAt: timestamp("ts_generated_at", { withTimezone: true }), // Darwin message timestamp
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_skipped_locations_tpl").on(table.tpl),
    index("idx_skipped_locations_rid").on(table.rid),
    index("idx_skipped_locations_created_at").on(table.createdAt),
  ],
);

/**
 * Seed log — tracks which PPTimetable files have been processed
 * Uses SHA-256 hash + mtime + file size to avoid re-processing unchanged files.
 * Full mode ignores this; normal mode skips files whose hash matches.
 */
export const seedLog = pgTable(
  "seed_log",
  {
    id: serial("id").primaryKey(),
    filename: varchar("filename", { length: 255 }).notNull().unique(),
    fileHash: varchar("file_hash", { length: 64 }).notNull(), // SHA-256 hex
    fileSize: integer("file_size"), // bytes
    fileMtime: timestamp("file_mtime", { withTimezone: true }), // filesystem mtime
    fileType: varchar("file_type", { length: 10 }).notNull(), // 'ref' or 'tt'
    ssd: varchar("ssd", { length: 10 }), // schedule start date (from filename)
    version: integer("version"), // version number (from filename)
    rowsAffected: integer("rows_affected"), // total rows processed
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_seed_log_file_type").on(table.fileType),
    index("idx_seed_log_processed_at").on(table.processedAt),
  ],
);

/** Type for inserting a seed log row */
export type NewSeedLog = typeof seedLog.$inferInsert;

/** Type for inserting a skipped location row */
export type NewSkippedLocation = typeof skippedLocations.$inferInsert;

/**
 * Station messages — OW (Station Message) data from Darwin Push Port
 * Each message has a unique message_id (from Darwin's id field).
 * Messages are UPSERTed — the same id can appear multiple times with updated content.
 */
export const stationMessages = pgTable(
  "station_messages",
  {
    id: serial("id").primaryKey(),
    messageId: varchar("message_id", { length: 20 }).notNull().unique(), // Darwin OW id field
    category: varchar("category", { length: 20 }), // Train, Station, Connections, System, Misc, PriorTrains, PriorOther
    severity: smallint("severity"), // 0=normal, 1=minor, 2=major, 3=severe
    suppress: boolean("suppress").notNull().default(false), // If true, don't show to public
    message: text("message").notNull(), // Normalised plain text
    messageRaw: text("message_raw"), // Original JSON for debugging
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_station_messages_category").on(table.category),
    index("idx_station_messages_created").on(table.createdAt),
  ],
);

/**
 * Station message stations — many-to-many junction
 * Links station_messages to CRS codes. A single OW message can affect
 * multiple stations (e.g. a route-wide disruption affecting 20+ stations).
 */
export const stationMessageStations = pgTable(
  "station_message_stations",
  {
    id: serial("id").primaryKey(),
    messageId: varchar("message_id", { length: 20 })
      .notNull()
      .references(() => stationMessages.messageId, { onDelete: "cascade" }),
    crs: char("crs", { length: 3 }).notNull(),
  },
  (table) => [
    index("idx_station_message_stations_crs").on(table.crs),
    uniqueIndex("idx_station_message_stations_unique").on(table.messageId, table.crs),
  ],
);

/** Type for inserting a station message row */
export type NewStationMessage = typeof stationMessages.$inferInsert;
/** Type for a station message row as read from the DB */
export type StationMessageRow = typeof stationMessages.$inferSelect;
/** Type for inserting a station message station row */
export type NewStationMessageStation = typeof stationMessageStations.$inferInsert;
/** Type for a station message station row as read from the DB */
export type StationMessageStationRow = typeof stationMessageStations.$inferSelect;
