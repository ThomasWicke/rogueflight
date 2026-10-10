import { defineConfig } from 'vite';

// build id sent with run telemetry: the commit on Cloudflare Pages, otherwise the build date
const BUILD = (process.env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) || new Date().toISOString().slice(0, 10);

export default defineConfig({
  root: 'client',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // reachable from a phone on the same Wi-Fi for quick on-device testing
    host: true,
  },
});
