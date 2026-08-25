import { execSync } from "node:child_process";
import { killKpBrowser } from "../features/kpPages/kpBrowser.service.js";
import { killPaBrowser } from "../features/paPages/paCloudflare.service.js";

// 2026-08-20 incident (vidi docs/DECISIONS.md): ingest worker je zaglavio 5 dana bez
// ijednog zavrsenog ciklusa, a niko/nista nije to primetilo dok korisnik nije rucno
// proverio bazu. `withTimeout()` u ingest.worker.ts sad sprecava POZNATI uzrok
// (zaglavljen Chromium poziv), ali ovo je odbrana u dubinu za SVAKI drugi neocekivan
// nacin da ciklus zaglavi (npr. baza/redis visi) — eksteran "heartbeat" watchdog koji
// ne zavisi od toga sto tacno zapinje unutra.
//
// Namerno NE koristi event loop blokadu kao signal (event loop NIJE bio blokiran
// tokom incidenta — notification worker je nastavio da kuca svaka 2 minuta dok je
// ingest bio mrtav), vec eksplicitan "javio sam se" heartbeat koji ingest.worker.ts
// zove na kraju SVAKOG zavrsenog ciklusa (uspesnog ili ne — bitno je samo da se
// ciklus zavrsio, a ne da je nesto pronadjeno).
const SCRAPE_INTERVAL_MINUTES = Number(process.env.SCRAPE_INTERVAL_MINUTES ?? 5);
const MISSED_CYCLES_THRESHOLD = Number(process.env.INGEST_WATCHDOG_MISSED_CYCLES ?? 5);
const STALE_MS = SCRAPE_INTERVAL_MINUTES * MISSED_CYCLES_THRESHOLD * 60_000;
const CHECK_INTERVAL_MS = 60_000;

let lastHeartbeatAt = Date.now();
let watchdogTimer: ReturnType<typeof setInterval> | undefined;

/** Zove ingest.worker.ts na kraju svakog zavrsenog ciklusa. */
export function markIngestHeartbeat(): void {
  lastHeartbeatAt = Date.now();
}

function killStrayChromium(): void {
  if (process.platform !== "linux") return;
  // Sinhrono i namerno (ne fire-and-forget kao *BrowserContext() gasenja) — zelimo
  // da ovo stigne da se izvrsi PRE process.exit() ispod. `|| true` jer pkill vraca
  // exit 1 kad nema procesa za ubijanje, sto bi execSync inace tretirao kao gresku.
  try {
    execSync('pkill -f "chrome-linux64/chrome" || true');
  } catch {
    // ignorisi — best effort ciscenje
  }
  try {
    execSync("pkill -f chrome_crashpad_handler || true");
  } catch {
    // ignorisi
  }
}

/** Pokrece se jednom pri boot-u procesa (server.ts). */
export function startIngestWatchdog(): void {
  if (watchdogTimer) return;

  watchdogTimer = setInterval(() => {
    const staleMs = Date.now() - lastHeartbeatAt;
    if (staleMs <= STALE_MS) return;

    console.error(
      `[watchdog] INGEST ZAGLAVLJEN — nijedan ciklus nije zavrsen ${Math.round(
        staleMs / 60_000,
      )} min (prag: ${MISSED_CYCLES_THRESHOLD} propustenih ciklusa = ${Math.round(
        STALE_MS / 60_000,
      )} min). Forsiram restart procesa (PM2 ce ga automatski podici nazad).`,
    );

    killKpBrowser();
    killPaBrowser();
    killStrayChromium();

    // Kratka pauza da fire-and-forget gasenja iznad stignu da se posalju pre nego
    // sto proces umre — process.exit() ne ceka nedovrsene async operacije.
    setTimeout(() => process.exit(1), 500);
  }, CHECK_INTERVAL_MS);

  // Ne drzi proces ziv samo zbog ovog tajmera (ne smeta gracefulShutdown-u u server.ts).
  watchdogTimer.unref();

  console.log(
    `[watchdog] Ingest watchdog pokrenut — restart posle ${MISSED_CYCLES_THRESHOLD} propustenih ciklusa (${Math.round(
      STALE_MS / 60_000,
    )} min bez zavrsenog ciklusa).`,
  );
}
