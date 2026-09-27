import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, EIP1193Provider, WalletClient } from 'viem';
import { createWalletClient, custom, getAddress, hexToNumber } from 'viem';
import type { Deployment } from './deployment';
import { walletAddChainParams } from './deployment';
import type { Env, WalletOption } from './env';
import { describeError } from './format';

export interface WalletState {
  wallets: WalletOption[];
  /** Undefined until the discovery window has closed. */
  discovered: boolean;
  selected?: WalletOption;
  account?: Address;
  chainId?: number;
  connecting: boolean;
  switching: boolean;
  error?: string;
  walletClient?: WalletClient;
  connect: (wallet: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

const STORAGE_KEY = 'lab-donation-vault:wallet';

function readStored(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStored(id: string | undefined) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be unavailable; the session still works */
  }
}

async function providerChainId(provider: EIP1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return hexToNumber(hex as `0x${string}`);
}

function isUnknownChainError(error: unknown): boolean {
  const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  const code = e?.code ?? e?.data?.originalError?.code;
  return code === 4902 || /unrecognized chain|unknown chain|wallet_addEthereumChain/i.test(e?.message ?? '');
}

export function useWallet(env: Env, deployment: Deployment | undefined): WalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [selected, setSelected] = useState<WalletOption>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string>();
  const autoConnected = useRef(false);

  useEffect(() => {
    return env.watchWallets((list) => {
      setWallets(list);
      setDiscovered(true);
    });
  }, [env]);

  // Track account and chain changes from the selected provider.
  useEffect(() => {
    if (!selected) return;
    const provider = selected.provider;
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAccount(list[0] ? getAddress(list[0]) : undefined);
    };
    const onChain = (hex: unknown) => setChainId(hexToNumber(hex as `0x${string}`));
    const onDisconnect = () => {
      setAccount(undefined);
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    provider.on('disconnect', onDisconnect);
    return () => {
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('chainChanged', onChain);
      provider.removeListener('disconnect', onDisconnect);
    };
  }, [selected]);

  const connect = useCallback(async (wallet: WalletOption) => {
    setConnecting(true);
    setError(undefined);
    try {
      const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const first = accounts[0];
      if (!first) throw new Error('The wallet returned no account. Unlock it and try again.');
      setSelected(wallet);
      setAccount(getAddress(first));
      setChainId(await providerChainId(wallet.provider));
      writeStored(wallet.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  // Silently reconnect a previously authorised wallet without prompting.
  useEffect(() => {
    if (autoConnected.current || wallets.length === 0) return;
    const storedId = readStored();
    const wallet = wallets.find((w) => w.id === storedId);
    if (!wallet) return;
    autoConnected.current = true;
    (async () => {
      try {
        const accounts = (await wallet.provider.request({ method: 'eth_accounts' })) as string[];
        const first = accounts[0];
        if (!first) return;
        setSelected(wallet);
        setAccount(getAddress(first));
        setChainId(await providerChainId(wallet.provider));
      } catch {
        /* the user will connect manually */
      }
    })();
  }, [wallets]);

  const disconnect = useCallback(() => {
    setSelected(undefined);
    setAccount(undefined);
    setChainId(undefined);
    setError(undefined);
    writeStored(undefined);
  }, []);

  const switchChain = useCallback(async () => {
    if (!selected || !deployment) return;
    const provider = selected.provider;
    const params = walletAddChainParams(deployment.network);
    setSwitching(true);
    setError(undefined);
    try {
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
      } catch (e) {
        if (!isUnknownChainError(e)) throw e;
        // The wallet does not know this chain: offer to add it, then switch again.
        await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
      }
      setChainId(await providerChainId(provider));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSwitching(false);
    }
  }, [selected, deployment]);

  const walletClient = useMemo(() => {
    if (!selected || !account || !deployment) return undefined;
    return createWalletClient({ account, chain: deployment.chain, transport: custom(selected.provider) });
  }, [selected, account, deployment]);

  return {
    wallets,
    discovered,
    ...(selected ? { selected } : {}),
    ...(account ? { account } : {}),
    ...(chainId !== undefined ? { chainId } : {}),
    connecting,
    switching,
    ...(error ? { error } : {}),
    ...(walletClient ? { walletClient } : {}),
    connect,
    disconnect,
    switchChain,
  };
}
