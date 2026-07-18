import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative base so the built site works whether it's served from a domain
  // root (local/kiosk use) or a GitHub Pages project subpath (/art_app/).
  base: './',
  publicDir: 'public',
  server: {
    host: true,
    port: 8080,
  },
  build: {
    outDir: 'dist',
  },
});
