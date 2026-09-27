import type { Hex, PublicClient } from 'viem';
import { parseAbiItem } from 'viem';
import { LOG_CHUNK_BLOCKS, MIN_LOG_CHUNK_BLOCKS } from './config';
import type { Deployment } from './deployment';
import { priceFromSnapshot } from './vault';

export interface SnapshotPoint {
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  timestamp: bigint;
  totalAssets: bigint;
  totalSupply: bigint;
  /** PIGY minor units per whole vPIGY share. */
  price: bigint;
}

export interface ScanResult {
  points: SnapshotPoint[];
  /** Last block included in the scan; resume from the next one. */
  scannedTo: bigint;
}

const snapshotEvent = parseAbiItem('event Snapshot(uint256 totalAssets, uint256 totalSupply)');

/**
 * Scan Snapshot events from `fromBlock` to the chain head in bounded chunks. Public RPCs
 * cap eth_getLogs ranges, so a rejected range is retried with half the span.
 */
export async function scanSnapshots(
  client: PublicClient,
  dep: Deployment,
  fromBlock: bigint,
  toBlock?: bigint,
  onProgress?: (scanned: bigint, total: bigint) => void,
): Promise<ScanResult> {
  // cacheTime 0: a refresh right after a confirmed transaction must see the new head.
  const head = toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const points: SnapshotPoint[] = [];
  const timestamps = new Map<bigint, bigint>();
  let chunk = LOG_CHUNK_BLOCKS;
  let cursor = fromBlock;

  while (cursor <= head) {
    const end = cursor + chunk - 1n > head ? head : cursor + chunk - 1n;
    let logs;
    try {
      logs = await client.getLogs({ address: dep.vault.address, event: snapshotEvent, fromBlock: cursor, toBlock: end });
    } catch (error) {
      if (chunk > MIN_LOG_CHUNK_BLOCKS) {
        chunk = chunk / 2n < MIN_LOG_CHUNK_BLOCKS ? MIN_LOG_CHUNK_BLOCKS : chunk / 2n;
        continue;
      }
      throw error;
    }
    for (const log of logs) {
      if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) continue;
      points.push({
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        timestamp: 0n,
        totalAssets: log.args.totalAssets ?? 0n,
        totalSupply: log.args.totalSupply ?? 0n,
        price: priceFromSnapshot(log.args.totalAssets ?? 0n, log.args.totalSupply ?? 0n),
      });
    }
    onProgress?.(end - fromBlock + 1n, head - fromBlock + 1n);
    cursor = end + 1n;
  }

  // Timestamps come from block headers; fetch each distinct block once.
  const blocks = [...new Set(points.map((p) => p.blockNumber))];
  await Promise.all(
    blocks.map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      timestamps.set(n, b.timestamp);
    }),
  );
  for (const p of points) p.timestamp = timestamps.get(p.blockNumber) ?? 0n;
  points.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return { points, scannedTo: head };
}
