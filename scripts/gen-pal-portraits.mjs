/**
 * Regenerate every pal portrait (assets/ui/pals/<key>.png) from the 3D models,
 * so the Season-Pass hero cards and any pal image stays consistent. Boots a
 * throwaway Vite dev server, drives palPortrait.html once per pal with headless
 * Chromium, and screenshots the transparent canvas at 420x560 (3:4).
 *
 *   npm run pal-portraits
 *
 * The pal list is derived from assets/models/pals/*.glb, so adding a glb + a
 * PALS entry is all it takes for a new portrait to appear here.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5234;
const BASE = `http://127.0.0.1:${PORT}`;

const keys = fs
  .readdirSync(path.join(root, 'assets/models/pals'))
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.replace(/\.glb$/, ''))
  .sort();

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vite dev server did not start at ${url}`);
}

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore'
});

let browser;
try {
  await waitForServer(BASE, 60_000);
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 1 });
  const outDir = path.join(root, 'assets/ui/pals');
  fs.mkdirSync(outDir, { recursive: true });
  for (const key of keys) {
    await page.goto(`${BASE}/palPortrait.html?key=${key}`);
    await page.waitForFunction(() => window.__portraitReady === true, null, { timeout: 30_000 });
    await page.locator('#c').screenshot({ path: path.join(outDir, `${key}.png`), omitBackground: true });
    process.stdout.write(`  ✓ ${key}\n`);
  }
  console.log(`Generated ${keys.length} pal portraits.`);
} finally {
  if (browser) await browser.close();
  vite.kill();
}
