import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// A build id that changes on every build. It is baked into the game AND written to version.json next to it,
// so a running (possibly cached) game can tell that a newer version has been published.
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${pad(now.getUTCDate())}.${pad(now.getUTCMonth() + 1)} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
const BUILD = { id: `${sha}-${now.getTime().toString(36)}`, label: `${sha} · ${stamp} UTC` };

export default defineConfig({
  base: '/Don-Game/',
  define: { __BUILD_ID__: JSON.stringify(BUILD.id), __BUILD_LABEL__: JSON.stringify(BUILD.label) },
  plugins: [{
    name: 'version-json',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) }); },
  }],
  test: { include: ['tests/unit/**/*.test.js'], define: { __BUILD_ID__: JSON.stringify('test'), __BUILD_LABEL__: JSON.stringify('test') } },
});
