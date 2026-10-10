import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // reachable from a phone on the same Wi-Fi for quick on-device testing
    host: true,
  },
});
