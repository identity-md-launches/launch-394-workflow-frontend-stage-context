export const MANIFEST_NAME: string;
export function canonicalJson(value: unknown): string;
export function abiHashOf(abi: unknown): string;
export function sha256Hex(bytes: Uint8Array | string): string;
export interface ManifestBuildOptions {
  handoff: Record<string, unknown> & { contracts: { name: string; address: string; abiHash: string; blockNumber: number }[] };
  networkFile: Record<string, unknown>;
  readAbi: (name: string) => unknown;
  distDir?: string;
}
export function buildManifest(opts: ManifestBuildOptions): Record<string, unknown>;
