import {
  pgTable,
  serial,
  varchar,
  char,
  integer,
  timestamp,
  index,
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

/** Type for inserting a station row */
export type NewStation = typeof stations.$inferInsert;
/** Type for a station row as read from the DB */
export type StationRow = typeof stations.$inferSelect;