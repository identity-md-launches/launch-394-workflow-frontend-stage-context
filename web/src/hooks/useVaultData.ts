import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, PublicClient } from 'viem';
import { DEPLOYMENT_BLOCK } from '../config';
import type { Deployment } from '../deployment';
import type { Env } from '../env';
import { describeError } from '../format';
import { scanSnapshots, type SnapshotPoint } from '../snapshots';
import { readPosition, readVaultState, type VaultSnapshotState, type WalletPosition } from '../vault';

export interface VaultData {
  vault?: VaultSnapshotState;
  vaultError?: string;
  position?: WalletPosition;
  positionError?: string;
  positionLoading: boolean;
  snapshots: SnapshotPoint[];
  snapshotsLoading: boolean;
  snapshotsError?: string;
  snapshotProgress?: { scanned: bigint; total: bigint };
  refresh: () => Promise<void>;
}

/** Live vault reads, the connected wallet's position and the Snapshot history. */
export function useVaultData(env: Env, client: PublicClient | undefined, dep: Deployment | undefined, account: Address | undefined): VaultData {
  const [vault, setVault] = useState<VaultSnapshotState>();
  const [vaultError, setVaultError] = useState<string>();
  const [position, setPosition] = useState<WalletPosition>();
  const [positionError, setPositionError] = useState<string>();
  const [positionLoading, setPositionLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsError, setSnapshotsError] = useState<string>();
  const [snapshotProgress, setSnapshotProgress] = useState<{ scanned: bigint; total: bigint }>();
  const scannedTo = useRef<bigint | undefined>(undefined);
  const scanning = useRef(false);
  const accountRef = useRef(account);
  accountRef.current = account;

  const refreshVault = useCallback(async () => {
    if (!client || !dep) return undefined;
    try {
      const state = await readVaultState(client, dep);
      setVault(state);
      setVaultError(undefined);
      return state;
    } catch (e) {
      setVaultError(describeError(e));
      return undefined;
    }
  }, [client, dep]);

  const refreshPosition = useCallback(
    async (asset: Address | undefined) => {
      const wallet = accountRef.current;
      if (!client || !dep || !wallet || !asset) {
        setPosition(undefined);
        return;
      }
      setPositionLoading(true);
      try {
        const p = await readPosition(client, dep, asset, wallet);
        if (accountRef.current === wallet) {
          setPosition(p);
          setPositionError(undefined);
        }
      } catch (e) {
        setPositionError(describeError(e));
      } finally {
        setPositionLoading(false);
      }
    },
    [client, dep],
  );

  const refreshSnapshots = useCallback(async () => {
    if (!client || !dep || scanning.current) return;
    scanning.current = true;
    setSnapshotsLoading(true);
    try {
      const from = scannedTo.current === undefined ? DEPLOYMENT_BLOCK : scannedTo.current + 1n;
      const result = await scanSnapshots(client, dep, from, undefined, (scanned, total) => setSnapshotProgress({ scanned, total }));
      scannedTo.current = result.scannedTo;
      if (result.points.length > 0) setSnapshots((prev) => [...prev, ...result.points]);
      setSnapshotsError(undefined);
    } catch (e) {
      setSnapshotsError(describeError(e));
    } finally {
      scanning.current = false;
      setSnapshotsLoading(false);
      setSnapshotProgress(undefined);
    }
  }, [client, dep]);

  const refresh = useCallback(async () => {
    const state = await refreshVault();
    await Promise.all([refreshPosition(state?.asset ?? vault?.asset), refreshSnapshots()]);
  }, [refreshVault, refreshPosition, refreshSnapshots, vault?.asset]);

  // Initial load and periodic refresh of live reads.
  useEffect(() => {
    if (!client || !dep) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const state = await refreshVault();
      if (!cancelled) await refreshPosition(state?.asset);
    };
    void tick();
    void refreshSnapshots();
    const timer = window.setInterval(tick, env.refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, dep, env.refreshIntervalMs, refreshVault, refreshPosition, refreshSnapshots]);

  // Reload the position when the account changes.
  useEffect(() => {
    void refreshPosition(vault?.asset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, vault?.asset]);

  return {
    ...(vault ? { vault } : {}),
    ...(vaultError ? { vaultError } : {}),
    ...(position ? { position } : {}),
    ...(positionError ? { positionError } : {}),
    positionLoading,
    snapshots,
    snapshotsLoading,
    ...(snapshotsError ? { snapshotsError } : {}),
    ...(snapshotProgress ? { snapshotProgress } : {}),
    refresh,
  };
}
