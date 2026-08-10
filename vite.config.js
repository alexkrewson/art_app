import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// The on-screen build stamp. Deliberately the SAME computation Gradle uses for
// versionCode (android/app/build.gradle: `git rev-list --count HEAD`), so the
// number on the tablet and the number in `adb shell dumpsys package` cannot
// disagree — the whole point of the stamp is telling builds apart. The short
// sha is there because a rebuild without a commit reuses the count.
function buildStamp() {
  try {
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return `v${count}.${sha}`;
  } catch {
    return 'v0.dev';   // same spirit as the Gradle fallback when git is absent
  }
}

export default defineConfig({
  root: '.',
  // Relative base so the built site works whether it's served from a domain
  // root (local/kiosk use) or a GitHub Pages project subpath (/art_app/).
  base: './',
  publicDir: 'public',
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
  },
  server: {
    host: true,
    port: 8080,
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
});
