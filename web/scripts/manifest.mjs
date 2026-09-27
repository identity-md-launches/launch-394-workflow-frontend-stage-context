#!/usr/bin/env node
// Writes ../dist/imd-deployment.json after `vite build`. Run via `npm run manifest`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_NAME, buildManifest } from './manifest-lib.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(webDir, '..', 'dist');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

if (!existsSync(join(distDir, 'index.html'))) {
  console.error(`No export found at ${distDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const handoff = readJson(join(webDir, 'deployment', 'handoff.json'));
const networkFile = readJson(join(webDir, 'deployment', 'network.json'));

// The app scans logs from the deployment block; keep src/config.ts in step with the handoff.
const config = readFileSync(join(webDir, 'src', 'config.ts'), 'utf8');
const configured = config.match(/DEPLOYMENT_BLOCK\s*=\s*(\d+)n/)?.[1];
const expected = String(Math.min(...handoff.contracts.map((c) => c.blockNumber)));
if (configured !== expected) {
  console.error(`src/config.ts DEPLOYMENT_BLOCK (${configured}) must equal the handoff block ${expected}`);
  process.exit(1);
}

const manifest = buildManifest({
  handoff,
  networkFile,
  readAbi: (name) => readJson(join(distDir, 'abi', `${name}.json`)),
  distDir,
});

const bytes = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(join(distDir, MANIFEST_NAME), bytes);
const total = manifest.assets.reduce((n, a) => n + readFileSync(join(distDir, a.path)).length, 0);
console.log(
  `Wrote ${MANIFEST_NAME}: ${manifest.contracts.length} contracts, ${manifest.assets.length} assets, ${total} bytes of assets`,
);
for (const a of manifest.assets) console.log(`  ${a.sha256}  ${a.path}`);
