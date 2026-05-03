import "dotenv/config";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

// Load root .env (monorepo root) — dotenv/config only loads from CWD
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootEnvPath = resolve(__dirname, "../../../../.env");
config({ path: rootEnvPath });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Check your .env file.",
  );
}

// Query client for regular queries
// Pool sizing: 20 connections to handle concurrent board requests.
// Each board request makes up to 3 parallel queries, so 20 supports
// ~6-7 concurrent board requests without queueing.
const queryClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
// queryClient re-export removed — use `db` only
