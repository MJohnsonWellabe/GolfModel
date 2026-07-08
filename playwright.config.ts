import { defineConfig } from '@playwright/test';

/**
 * Visual-capture harness config (`npm run shots`). Screenshots are a contact
 * sheet for art review, not a pass/fail gate — specs write PNGs and never
 * compare against goldens. Runs against the Vite dev server.
 *
 * The environment pre-installs Chromium at /opt/pw-browsers (see the
 * `chromium` symlink); never run `playwright install`.
 */
export default defineConfig({
  testDir: 'tests/visual',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 720, height: 1280 },
    deviceScaleFactor: 1,
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
      // Software WebGL so captures work in headless/CI containers
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ]
    }
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
