import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const docsData = path.resolve(__dirname, "../docs/data");

/**
 * In dev, serve the pipeline's committed JSON (../docs/data) at /data/* so the
 * app sees the same artifacts it will fetch in production. No backend needed.
 */
function serveDocsData(): Plugin {
  return {
    name: "serve-docs-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/data/")) {
          const rel = decodeURIComponent(req.url.split("?")[0].replace(/^\/data\//, ""));
          const file = path.join(docsData, rel);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "text/plain");
            fs.createReadStream(file).pipe(res);
            return;
          }
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Relative base so the site works under https://<user>.github.io/GolfModel/.
  base: "./",
  plugins: [react(), serveDocsData()],
  build: {
    // Pages serves from /docs; keep the committed docs/data alongside the build.
    outDir: "../docs",
    emptyOutDir: false,
    assetsDir: "assets",
  },
});
