/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { MANIFEST_NAME, buildManifest } from './scripts/manifest-lib.mjs';

/**
 * During `vite dev` there is no dist/, so serve a manifest generated in memory from the
 * same handoff files (without the asset list). The production manifest is written by
 * scripts/manifest.mjs after `vite build`.
 */
function devManifest(): Plugin {
  return {
    name: 'imd-dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== `/${MANIFEST_NAME}`) return next();
        const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
        const manifest = buildManifest({
          handoff: readJson(join(__dirname, 'deployment', 'handoff.json')),
          networkFile: readJson(join(__dirname, 'deployment', 'network.json')),
          readAbi: (name: string) => readJson(join(__dirname, 'public', 'abi', `${name}.json`)),
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(manifest, null, 2));
      });
    },
  };
}

// The static export lives at the repository root (../dist) and uses a relative
// base so it works from an IPFS gateway subpath, an ENS name or a plain folder.
export default defineConfig({
  plugins: [react(), devManifest()],
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
    // viem + react in one chunk is ~550 kB minified (~170 kB gzip); one file keeps the export simple.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
