/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// base './' makes all asset URLs relative so the build works when served
// from the GitHub Pages project subpath (e.g. /GolfModel/).
// The build lands in dist/ (not committed); GitHub Actions publishes it to
// Pages — see .github/workflows/deploy.yml. The docs/ folder holds the
// project's design documentation, not the build.
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  publicDir: 'assets',
  // Vitest collects unit tests only — tests/visual/*.spec.ts belong to the
  // Playwright screenshot harness (`npm run shots`), not the unit runner.
  test: {
    include: ['tests/**/*.test.ts']
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        // The 3D game is the sole experience, served at the root URL.
        main: resolve(__dirname, 'index.html'),
        // Redirect stub preserving the old /slice3d.html bookmark
        slice3d: resolve(__dirname, 'slice3d.html'),
        // Owner-only stats dashboard (Google sign-in gated in-page)
        admin: resolve(__dirname, 'admin.html'),
        // Owner-reached press/marketing kit (linked from the admin dashboard)
        marketing: resolve(__dirname, 'marketing.html')
      }
    }
  }
});
