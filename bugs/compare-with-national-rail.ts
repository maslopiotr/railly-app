/**
 * Compare Railly board data against National Rail (or manual snapshot).
 *
 * Usage:
 *   npx tsx bugs/compare-with-national-rail.ts --crs EUS --time 17:00
 *
 * This fetches our board API and prints a formatted table that can be
 * compared against https://www.nationalrail.co.uk/live-trains/departures/:crs/
 *
 * To capture a snapshot from National Rail:
 *   1. Open the URL above
 *   2. Copy the visible departures table
 *   3. Paste into bugs/nr-snapshot-<crs>-<time>.txt
 *   4. Run this script and compare side-by-side
 */

import fs from "fs";
import path from "path";

interface CliArgs {
  crs: string;
  time?: string;
  apiUrl: string;
  outputFile?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let crs: string | undefined;
  let time: string | undefined;
  let apiUrl = "http://localhost:3000";
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--crs" && args[i + 1]) crs = args[i + 1].toUpperCase();
    if (args[i] === "--time" && args[i + 1]) time = args[i + 1];
    if (args[i] === "--api" && args[i + 1]) apiUrl = args[i + 1];
    if (args[i] === "--out" && args[i + 1]) outputFile = args[i + 1];
  }

  if (!crs) {
    console.error("Usage: npx tsx bugs/compare-with-national-rail.ts --crs EUS [--time 17:00] [--api http://localhost:3000] [--out file.md]");
    process.exit(1);
  }

  return { crs, time, apiUrl, outputFile };
}

interface BoardService {
  rid: string;
  uid: string;
  std: string | null;
  sta: string | null;
  platform: string | null;
  platformLive: string | null;
  platformSource: string;
  platIsSuppressed: boolean;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  isCancelled: boolean;
  delayMinutes: number | null;
  trainStatus: string;
  hasRealtime: boolean;
  origin: { name: string | null };
  destination: { name: string | null };
  tocName: string | null;
  callingPoints: Array<{
    tpl: string;
    name: string;
    pta: string | null;
    ptd: string | null;
    eta: string | null;
    etd: string | null;
    ata: string | null;
    atd: string | null;
    platformLive: string | null;
    plat: string | null;
    isCancelled: boolean;
  }>;
}

async function fetchBoard(apiUrl: string, crs: string, time?: string): Promise<BoardService[]> {
  const url = new URL(`/api/v1/stations/${crs}/board`, apiUrl);
  url.searchParams.set("type", "departures");
  url.searchParams.set("timeWindow", "120");
  if (time) url.searchParams.set("time", time);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { services?: BoardService[] };
  return data.services || [];
}

function formatTime(sched: string | null, rt: string | null, actual: string | null): string {
  if (actual) return `${sched}→${actual}A`;
  if (rt && rt !== sched) return `${sched}→${rt}`;
  if (rt === "Cancelled") return `${sched}→CANX`;
  return sched || "-";
}

function formatPlatform(plat: string | null, live: string | null, source: string, suppressed: boolean): string {
  if (suppressed) return `${plat}*`;
  if (source === "altered" && live && plat !== live) return `${plat}→${live}!`;
  if (live) return live;
  return plat || "?";
}

function formatService(svc: BoardService, idx: number): string {
  const timeStr = formatTime(svc.std, svc.etd, svc.atd);
  const platStr = formatPlatform(svc.platform, svc.platformLive, svc.platformSource, svc.platIsSuppressed);
  const statusStr = svc.isCancelled
    ? "CANCELLED"
    : svc.delayMinutes && svc.delayMinutes > 0
      ? `${svc.delayMinutes}m late`
      : svc.trainStatus;
  const dest = svc.destination?.name || "???";

  const lines = [
    `${idx + 1}. ${timeStr} | Plat ${platStr} | ${dest} (${svc.tocName || "?"})`,
    `   Status: ${statusStr} | RID: ${svc.rid} | UID: ${svc.uid}`,
    `   Has RT: ${svc.hasRealtime ? "Y" : "N"} | Delay: ${svc.delayMinutes ?? "-"}min`,
  ];

  // Add calling points with platform changes
  const cpWithPlat = svc.callingPoints.filter(
    (cp) => cp.platformLive && cp.plat && cp.platformLive !== cp.plat
  );
  if (cpWithPlat.length > 0) {
    lines.push(
      `   ⚠️ Platform changes:`,
      ...cpWithPlat.map(
        (cp) =>
          `      ${cp.name}: ${cp.plat}→${cp.platformLive} ${cp.isCancelled ? "[CANX]" : ""}`
      )
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  const timestamp = new Date().toISOString();

  console.log(`Fetching Railly board for ${args.crs}${args.time ? ` @ ${args.time}` : ""}...`);
  const services = await fetchBoard(args.apiUrl, args.crs, args.time);

  console.log(`\nFound ${services.length} services\n`);

  const lines: string[] = [];
  lines.push(`# Railly vs National Rail — ${args.crs} @ ${args.time || "now"}`);
  lines.push(`Captured: ${timestamp}`);
  lines.push(`API: ${args.apiUrl}`);
  lines.push(`---`);
  lines.push(`Compare against: https://www.nationalrail.co.uk/live-trains/departures/${args.crs.toLowerCase()}/`);
  lines.push(`---\n`);

  for (let i = 0; i < services.length; i++) {
    const formatted = formatService(services[i], i);
    lines.push(formatted);
    lines.push("");
    console.log(formatted);
    console.log("");
  }

  // Write to file if requested
  if (args.outputFile) {
    const outPath = path.resolve(args.outputFile);
    fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
    console.log(`\nWrote comparison to ${outPath}`);
  }

  // Also write a standard snapshot file
  const snapshotFile = path.resolve(`bugs/nr-snapshot-railly-${args.crs}-${args.time || "now"}-${timestamp.replace(/[:.]/g, "-")}.md`);
  fs.writeFileSync(snapshotFile, lines.join("\n"), "utf-8");
  console.log(`Wrote snapshot to ${snapshotFile}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});