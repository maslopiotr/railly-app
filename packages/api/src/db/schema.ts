import {
  pgTable,
  serial,
  varchar,
  char,
  integer,
  timestamp,
  index,
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
    plat: varchar("plat", { length: 5 }), // Booked platform
    pta: char("pta", { length: 5 }), // Public arrival time HH:MM
    ptd: char("ptd", { length: 5 }), // Public departure time HH:MM
    wta: varchar("wta", { length: 8 }), // Working arrival time
    wtd: varchar("wtd", { length: 8 }), // Working departure time
    wtp: varchar("wtp", { length: 8 }), // Working passing time
    act: varchar("act", { length: 10 }), // Activities (TB, TF, T, etc.)
  },
  (table) => [
    index("idx_calling_points_journey_rid").on(table.journeyRid),
    index("idx_calling_points_crs").on(table.crs),
    index("idx_calling_points_tpl").on(table.tpl),
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
