/**
 * Train Status handler — Thin re-export module
 *
 * The actual implementation is split across focused sub-modules:
 * - ts/utils.ts     — Pure helper functions (toArray, parseTs, deriveSsdFromRid, etc.)
 * - ts/matching.ts  — Location-to-CP matching (matchLocationsToCps)
 * - ts/stub.ts      — Darwin stub creation for unknown services (createDarwinStub)
 * - ts/handler.ts   — Main orchestration (handleTrainStatus, skippedLocationsTotal)
 *
 * This file exists solely to preserve the import path used by handlers/index.ts:
 *   import { handleTrainStatus } from "./trainStatus.js"
 */

export { handleTrainStatus, skippedLocationsTotal } from "./ts/handler.js";