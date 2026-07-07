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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        // The 3D game is the primary experience served at the root URL
        main: resolve(__dirname, 'index.html'),
        // The original 2D game, kept playable at /classic.html
        classic: resolve(__dirname, 'classic.html'),
        // Redirect stub preserving the old /slice3d.html bookmark
        slice3d: resolve(__dirname, 'slice3d.html')
      }
    }
  }
});
