// Builds dist/imd-deployment.json from the validated deployment handoff.
//
// Inputs (committed under web/deployment/):
//   handoff.json  – the workflow deployment handoff (addresses, ABI hashes, launch id, ...)
//   network.json  – the vetted chain table entry; its `network` block is copied byte for byte
// The ABIs under web/public/abi/ are the implementation-derived exports from the pinned
// source commit. Their canonical Keccak-256 hash must equal the handoff abiHash or the
// build fails, so the site can never ship an ABI that disagrees with the attested handoff.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { keccak256, stringToBytes } from 'viem';

export const MANIFEST_NAME = 'imd-deployment.json';
const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Deterministic JSON: object keys sorted, no whitespace. Matches the handoff's canonicalKeccak. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function abiHashOf(abi) {
  return keccak256(stringToBytes(canonicalJson(abi))).slice(2);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isHex64(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

/**
 * Produce the manifest object (without the `assets` list when `distDir` is omitted).
 * @param {object} opts
 * @param {object} opts.handoff   parsed web/deployment/handoff.json
 * @param {object} opts.networkFile parsed web/deployment/network.json
 * @param {(name: string) => unknown} opts.readAbi returns the parsed ABI array for a contract name
 * @param {string} [opts.distDir] when given, every file under it except the manifest is hashed
 */
export function buildManifest({ handoff, networkFile, readAbi, distDir }) {
  if (handoff.version !== 1) throw new Error(`unsupported handoff version ${handoff.version}`);
  if (!isHex64(handoff.attestationHash)) throw new Error('handoff attestationHash is not 64 hex chars');
  if (!/^[0-9a-f]{40}$/.test(handoff.sourceCommit)) throw new Error('handoff sourceCommit is not a commit hash');
  if (!networkFile?.network || networkFile.network.chainId !== handoff.chainId) {
    throw new Error('network.json chainId does not match the handoff chainId');
  }

  const contracts = handoff.contracts.map((c) => {
    const abi = readAbi(c.name);
    if (!Array.isArray(abi)) throw new Error(`ABI for ${c.name} is not a JSON array`);
    const hash = abiHashOf(abi);
    if (hash !== c.abiHash) {
      throw new Error(`ABI hash mismatch for ${c.name}: computed ${hash}, handoff ${c.abiHash}`);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(c.address)) throw new Error(`bad address for ${c.name}`);
    return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` };
  });

  const manifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts,
    assets: [],
    // Copied unchanged from the vetted chain table entry.
    network: networkFile.network,
  };

  if (distDir) {
    manifest.assets = listAssets(distDir);
    for (const c of contracts) {
      const asset = manifest.assets.find((a) => a.path === c.abiPath);
      if (!asset) throw new Error(`export is missing ${c.abiPath}`);
      const exported = JSON.parse(readFileSync(join(distDir, c.abiPath), 'utf8'));
      if (abiHashOf(exported) !== c.abiHash) throw new Error(`exported ${c.abiPath} does not match abiHash`);
    }
    if (!manifest.assets.some((a) => a.path === 'index.html')) throw new Error('export is missing index.html');
    if (manifest.assets.length > MAX_ASSETS) throw new Error(`too many assets: ${manifest.assets.length}`);
  }
  return manifest;
}

function listAssets(distDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(distDir, full).split(sep).join('/');
      if (rel === MANIFEST_NAME) continue;
      if (st.size > MAX_FILE_BYTES) throw new Error(`${rel} exceeds 8 MiB`);
      out.push({ path: rel, sha256: sha256Hex(readFileSync(full)) });
    }
  };
  walk(distDir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
