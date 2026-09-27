import type { Abi, Address, Chain } from 'viem';
import { isAddress } from 'viem';
import { DEPLOYMENT_MANIFEST_PATH, TOKEN_CONTRACT, VAULT_CONTRACT } from './config';

/** The `network` block of imd-deployment.json (copied from the vetted chain table). */
export interface NetworkInfo {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network: NetworkInfo;
}

export interface ContractBinding {
  name: string;
  address: Address;
  abi: Abi;
  abiHash: string;
}

/** Everything the app needs about the deployment, resolved from the manifest at runtime. */
export interface Deployment {
  manifest: DeploymentManifest;
  chain: Chain;
  network: NetworkInfo;
  vault: ContractBinding;
  token: ContractBinding;
  explorerUrl: (kind: 'address' | 'tx' | 'block', value: string) => string;
}

export type JsonFetcher = (relativePath: string) => Promise<unknown>;

function fail(msg: string): never {
  throw new Error(`Deployment configuration is invalid: ${msg}`);
}

function isRelativePath(p: string): boolean {
  return p.length > 0 && !p.startsWith('/') && !/^[a-z]+:/i.test(p) && !p.split('/').includes('..');
}

export function parseManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') fail('not an object');
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) fail(`unsupported version ${String(m.version)}`);
  if (typeof m.launchId !== 'string') fail('missing launchId');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId)) fail('missing chainId');
  if (typeof m.sourceCommit !== 'string') fail('missing sourceCommit');
  if (typeof m.attestationHash !== 'string') fail('missing attestationHash');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) fail('missing contracts');
  for (const c of m.contracts as Record<string, unknown>[]) {
    if (typeof c.name !== 'string') fail('contract without name');
    if (typeof c.address !== 'string' || !isAddress(c.address, { strict: false })) fail(`bad address for ${c.name}`);
    if (typeof c.abiHash !== 'string' || !/^[0-9a-f]{64}$/.test(c.abiHash)) fail(`bad abiHash for ${c.name}`);
    if (typeof c.abiPath !== 'string' || !isRelativePath(c.abiPath)) fail(`bad abiPath for ${c.name}`);
  }
  if (!Array.isArray(m.assets)) fail('missing assets');
  const n = m.network as Record<string, unknown> | undefined;
  if (!n || typeof n !== 'object') fail('missing network');
  if (n.chainId !== m.chainId) fail('network.chainId differs from chainId');
  if (typeof n.name !== 'string') fail('network.name');
  if (!Array.isArray(n.rpcUrls) || n.rpcUrls.length === 0) fail('network.rpcUrls');
  if (typeof n.explorer !== 'string') fail('network.explorer');
  const nc = n.nativeCurrency as Record<string, unknown> | undefined;
  if (!nc || typeof nc.symbol !== 'string' || typeof nc.decimals !== 'number') fail('network.nativeCurrency');
  const u = n.uniswapV4 as Record<string, unknown> | undefined;
  if (!u) fail('network.uniswapV4');
  for (const k of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2']) {
    if (typeof u[k] !== 'string' || !isAddress(u[k] as string, { strict: false })) fail(`network.uniswapV4.${k}`);
  }
  return raw as DeploymentManifest;
}

export function chainFromNetwork(network: NetworkInfo): Chain {
  return {
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
  };
}

/** Parameters for wallet_addEthereumChain, derived from the same network block. */
export function walletAddChainParams(network: NetworkInfo) {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

export async function loadDeployment(fetchJson: JsonFetcher): Promise<Deployment> {
  const manifest = parseManifest(await fetchJson(DEPLOYMENT_MANIFEST_PATH));
  const bind = async (name: string): Promise<ContractBinding> => {
    const entry = manifest.contracts.find((c) => c.name === name);
    if (!entry) fail(`contract ${name} is not in the manifest`);
    const abi = await fetchJson(entry.abiPath);
    if (!Array.isArray(abi)) fail(`${entry.abiPath} is not an ABI array`);
    return { name, address: entry.address, abi: abi as Abi, abiHash: entry.abiHash };
  };
  const [vault, token] = await Promise.all([bind(VAULT_CONTRACT), bind(TOKEN_CONTRACT)]);
  const network = manifest.network;
  const base = network.explorer.replace(/\/$/, '');
  return {
    manifest,
    network,
    chain: chainFromNetwork(network),
    vault,
    token,
    explorerUrl: (kind, value) => `${base}/${kind}/${value}`,
  };
}

/** Default fetcher: resolves paths against the document so a gateway subpath works. */
export function browserJsonFetcher(): JsonFetcher {
  return async (relativePath) => {
    const url = new URL(relativePath, document.baseURI);
    const res = await fetch(url.toString(), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Unable to load ${relativePath} (HTTP ${res.status})`);
    return res.json();
  };
}
