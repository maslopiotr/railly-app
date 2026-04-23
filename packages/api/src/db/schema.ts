import {
  pgTable,
  serial,
  varchar,
  char,
  integer,
  timestamp,
  index,
  uniqueIndex,
  boolean,
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
    isPassenger: boolean("is_passenger").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_journeys_uid_ssd").on(table.uid, table.ssd),
    index("idx_journeys_toc").on(table.toc),
    index("idx_journeys_ssd").on(table.ssd),
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
    sequence: integer("sequence").notNull(), // Order within journey
    stopType: varchar("stop_type", { length: 5 }).notNull(), // OR, DT, IP, PP, OPOR, OPIP, OPDT
    tpl: varchar("tpl", { length: 10 }).notNull(), // TIPLOC code
    crs: char("crs", { length: 3 }), // CRS code (from location_ref lookup)
    // -- Static: from PP Timetable (seeded daily) --
    plat: varchar("plat", { length: 5 }), // Booked platform
    pta: char("pta", { length: 5 }), // Public arrival time HH:MM
    ptd: char("ptd", { length: 5 }), // Public departure time HH:MM
    wta: varchar("wta", { length: 8 }), // Working arrival time
    wtd: varchar("wtd", { length: 8 }), // Working departure time
    wtp: varchar("wtp", { length: 8 }), // Working passing time
    act: varchar("act", { length: 10 }), // Activities (TB, TF, T, etc.)
    // -- Real-time: from Darwin Push Port (updated live) --
    eta: char("eta", { length: 5 }), // Estimated arrival HH:MM
    etd: char("etd", { length: 5 }), // Estimated departure HH:MM
    ata: char("ata", { length: 5 }), // Actual arrival HH:MM
    atd: char("atd", { length: 5 }), // Actual departure HH:MM
    livePlat: varchar("live_plat", { length: 5 }), // Live platform from Darwin
    isCancelled: boolean("is_cancelled").default(false).notNull(),
    delayMinutes: integer("delay_minutes"), // Computed delay vs scheduled
    platIsSuppressed: boolean("plat_is_suppressed").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }), // Last Darwin message
  },
  (table) => [
    index("idx_calling_points_journey_rid").on(table.journeyRid),
    index("idx_calling_points_crs").on(table.crs),
    index("idx_calling_points_tpl").on(table.tpl),
    uniqueIndex("idx_calling_points_journey_rid_sequence").on(
      table.journeyRid,
      table.sequence,
    ),
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
    generatedAt: timestamp("generated_at", { withTimezone: true }), // Darwin timestamp
    lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_service_rt_rid").on(table.rid)],
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
    rid: varchar("rid", { length: 20 }).notNull(),
    rawJson: varchar("raw_json", { length: 20000 }), // Truncated raw message
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
/** Type for inserting a darwin_events row */
export type NewDarwinEvent = typeof darwinEvents.$inferInsert;