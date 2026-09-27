import type { Address, PublicClient } from 'viem';
import type { Deployment } from './deployment';

/**
 * Thin typed wrappers around the runtime-loaded ABIs. The ABI itself comes from
 * imd-deployment.json; these helpers only name the functions the page uses and
 * narrow their result types.
 */

export interface VaultSnapshotState {
  asset: Address;
  assetSymbol: string;
  assetDecimals: number;
  shareSymbol: string;
  shareDecimals: number;
  totalAssets: bigint;
  totalSupply: bigint;
  sharePrice: bigint;
  unvested: bigint;
  lockedAmount: bigint;
  lockEnd: bigint;
  unlockDuration: bigint;
  vaultTokenBalance: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
}

export interface WalletPosition {
  tokenBalance: bigint;
  allowance: bigint;
  shares: bigint;
  shareValue: bigint;
  maxRedeem: bigint;
}

type ReadArgs = readonly unknown[];

async function read<T>(client: PublicClient, target: { address: Address; abi: Deployment['vault']['abi'] }, functionName: string, args: ReadArgs = []): Promise<T> {
  return (await client.readContract({ address: target.address, abi: target.abi, functionName, args })) as T;
}

export async function readVaultState(client: PublicClient, dep: Deployment): Promise<VaultSnapshotState> {
  const block = await client.getBlock({ blockTag: 'latest' });
  const opts = { blockNumber: block.number } as const;
  const v = dep.vault;
  const rd = <T>(fn: string, args: ReadArgs = []) =>
    client.readContract({ address: v.address, abi: v.abi, functionName: fn, args, ...opts }) as Promise<T>;

  const [asset, shareSymbol, shareDecimals, totalAssets, totalSupply, sharePrice, unvested, lockedAmount, lockEnd, unlockDuration] =
    await Promise.all([
      rd<Address>('token'),
      rd<string>('symbol'),
      rd<number>('decimals'),
      rd<bigint>('totalAssets'),
      rd<bigint>('totalSupply'),
      rd<bigint>('sharePrice'),
      rd<bigint>('unvested'),
      rd<bigint>('lockedAmount'),
      rd<bigint>('lockEnd'),
      rd<bigint>('UNLOCK_DURATION'),
    ]);

  // The PIGY address comes from vault.token(); the manifest's LaunchToken entry supplies its ABI.
  const token = { address: asset, abi: dep.token.abi };
  const [assetSymbol, assetDecimals, vaultTokenBalance] = await Promise.all([
    client.readContract({ ...token, functionName: 'symbol', ...opts }) as Promise<string>,
    client.readContract({ ...token, functionName: 'decimals', ...opts }) as Promise<number>,
    client.readContract({ ...token, functionName: 'balanceOf', args: [v.address], ...opts }) as Promise<bigint>,
  ]);

  return {
    asset,
    assetSymbol,
    assetDecimals,
    shareSymbol,
    shareDecimals,
    totalAssets,
    totalSupply,
    sharePrice,
    unvested,
    lockedAmount,
    lockEnd,
    unlockDuration,
    vaultTokenBalance,
    blockNumber: block.number,
    blockTimestamp: block.timestamp,
  };
}

export async function readPosition(
  client: PublicClient,
  dep: Deployment,
  asset: Address,
  wallet: Address,
): Promise<WalletPosition> {
  const token = { address: asset, abi: dep.token.abi };
  const [tokenBalance, allowance, shares, maxRedeem] = await Promise.all([
    client.readContract({ ...token, functionName: 'balanceOf', args: [wallet] }) as Promise<bigint>,
    client.readContract({ ...token, functionName: 'allowance', args: [wallet, dep.vault.address] }) as Promise<bigint>,
    read<bigint>(client, dep.vault, 'balanceOf', [wallet]),
    read<bigint>(client, dep.vault, 'maxRedeem', [wallet]),
  ]);
  const shareValue = shares === 0n ? 0n : await read<bigint>(client, dep.vault, 'convertToAssets', [shares]);
  return { tokenBalance, allowance, shares, shareValue, maxRedeem };
}

export async function previewDeposit(client: PublicClient, dep: Deployment, assets: bigint): Promise<bigint> {
  return read<bigint>(client, dep.vault, 'previewDeposit', [assets]);
}

export async function previewRedeem(client: PublicClient, dep: Deployment, shares: bigint): Promise<bigint> {
  return read<bigint>(client, dep.vault, 'previewRedeem', [shares]);
}

/** Share price implied by a Snapshot(totalAssets, totalSupply): floor(1e24 * (A+1) / (S+1e6)). */
export function priceFromSnapshot(totalAssets: bigint, totalSupply: bigint): bigint {
  return (10n ** 24n * (totalAssets + 1n)) / (totalSupply + 1_000_000n);
}

/** unvested(t) as the contract computes it, for the live countdown between refreshes. */
export function unvestedAt(lockedAmount: bigint, lockEnd: bigint, unlockDuration: bigint, now: bigint): bigint {
  if (now >= lockEnd || unlockDuration === 0n) return 0n;
  return (lockedAmount * (lockEnd - now)) / unlockDuration;
}
