/**
 * Darwin Push Port: Structured logging with LOG_LEVEL control
 *
 * Set LOG_LEVEL env var to control verbosity:
 *   error  — only errors
 *   warn   — errors + warnings (including skipped locations)
 *   info   — errors + warnings + important events (default)
 *   debug  — everything (per-message success logs, dedup skips, batch info)
 */

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const levelNum = LEVELS[currentLevel] ?? LEVELS.info;

export const log = {
  error: (...args: unknown[]): void => {
    if (levelNum >= LEVELS.error) console.error(...args);
  },
  warn: (...args: unknown[]): void => {
    if (levelNum >= LEVELS.warn) console.warn(...args);
  },
  info: (...args: unknown[]): void => {
    if (levelNum >= LEVELS.info) console.log(...args);
  },
  debug: (...args: unknown[]): void => {
    if (levelNum >= LEVELS.debug) console.log(...args);
  },
};