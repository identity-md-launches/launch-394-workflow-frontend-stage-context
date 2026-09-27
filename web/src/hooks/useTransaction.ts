import { useCallback, useRef, useState } from 'react';
import type { Abi, Address, Hex, PublicClient, WalletClient } from 'viem';
import { describeError, isUserRejection } from '../format';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'cancelled' | 'failed';

export interface TxStatus {
  phase: TxPhase;
  /** What the transaction does, in plain words, e.g. "Deposit 10 PIGY". */
  label?: string;
  hash?: Hex;
  error?: string;
}

export interface TxRequest {
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export interface TxController {
  status: TxStatus;
  busy: boolean;
  send: (req: TxRequest) => Promise<boolean>;
  reset: () => void;
}

/**
 * Simulate, sign, broadcast and confirm one contract call at a time. Simulation runs
 * against the public RPC with the connected account so a revert is shown before the
 * wallet ever opens.
 */
export function useTransaction(
  publicClient: PublicClient | undefined,
  walletClient: WalletClient | undefined,
  account: Address | undefined,
  receiptPollMs: number,
  onConfirmed?: () => void | Promise<void>,
): TxController {
  const [status, setStatus] = useState<TxStatus>({ phase: 'idle' });
  const inFlight = useRef(false);

  const send = useCallback(
    async (req: TxRequest) => {
      if (!publicClient || !walletClient || !account || inFlight.current) return false;
      inFlight.current = true;
      setStatus({ phase: 'simulating', label: req.label });
      try {
        const { request } = await publicClient.simulateContract({
          account,
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args,
        });
        setStatus({ phase: 'signing', label: req.label });
        const hash = await walletClient.writeContract({ ...request, account, chain: walletClient.chain });
        setStatus({ phase: 'pending', label: req.label, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: receiptPollMs });
        if (receipt.status !== 'success') {
          setStatus({ phase: 'failed', label: req.label, hash, error: 'The transaction was mined but reverted.' });
          return false;
        }
        setStatus({ phase: 'confirmed', label: req.label, hash });
        await onConfirmed?.();
        return true;
      } catch (e) {
        const error = describeError(e);
        const cancelled = isUserRejection(e);
        setStatus((s) => ({ phase: cancelled ? 'cancelled' : 'failed', label: req.label, ...(s.hash ? { hash: s.hash } : {}), error }));
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [publicClient, walletClient, account, receiptPollMs, onConfirmed],
  );

  const reset = useCallback(() => setStatus({ phase: 'idle' }), []);
  const busy = status.phase === 'simulating' || status.phase === 'signing' || status.phase === 'pending';
  return { status, busy, send, reset };
}
