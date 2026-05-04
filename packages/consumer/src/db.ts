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
 * Begin a write transaction with an extended statement timeout.
 *
 * The global PostgreSQL `statement_timeout` (5s) is too tight for write
 * transactions that may contend with the seed process or other concurrent
 * consumer messages. `SET LOCAL` scopes the override to the current
 * transaction — it resets automatically on commit/rollback.
 */
export function beginWrite(
  fn: (tx: postgres.TransactionSql<postgres.Row>) => Promise<unknown>,
): Promise<unknown> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '15s'`;
    return fn(tx);
  }) as Promise<unknown>;
}

/**
 * Gracefully close the PostgreSQL connection.
 */
export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
