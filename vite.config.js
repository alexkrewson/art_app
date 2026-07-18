import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: true,
    port: 8080,
  },
  build: {
    outDir: 'dist',
  },
});
