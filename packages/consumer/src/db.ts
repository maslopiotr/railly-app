/**
 * PostgreSQL client for the Darwin consumer
 *
 * Uses postgres.js for raw SQL queries. The consumer writes real-time
 * data directly to the calling_points and service_rt tables.
 */

import "./env.js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Consumer cannot connect to PostgreSQL.",
  );
}

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Gracefully close the PostgreSQL connection.
 */
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}