import { defineConfig } from 'vite';

// base './' makes all asset URLs relative so the build works when served
// from the GitHub Pages project subpath (e.g. /GolfModel/).
// The build lands in dist/ (not committed); GitHub Actions publishes it to
// Pages — see .github/workflows/deploy.yml. The docs/ folder holds the
// project's design documentation, not the build.
export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0
  }
});
