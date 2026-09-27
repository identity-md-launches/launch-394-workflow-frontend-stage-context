import type { EIP1193Provider, Transport } from 'viem';
import { fallback, http } from 'viem';
import { browserJsonFetcher, type JsonFetcher, type NetworkInfo } from './deployment';
import { RECEIPT_POLL_MS, REFRESH_INTERVAL_MS } from './config';

/** A wallet discovered through EIP-6963 or the legacy window.ethereum global. */
export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

/**
 * Everything that touches the outside world, so tests can substitute a fake chain
 * and a fake wallet without patching globals.
 */
export interface Env {
  fetchJson: JsonFetcher;
  publicTransport: (network: NetworkInfo) => Transport;
  /** Subscribe to the list of available wallets. Returns an unsubscribe function. */
  watchWallets: (onChange: (wallets: WalletOption[]) => void) => () => void;
  refreshIntervalMs: number;
  receiptPollMs: number;
  now: () => number;
}

interface EIP6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

export function browserEnv(): Env {
  return {
    fetchJson: browserJsonFetcher(),
    publicTransport: (network) =>
      fallback(
        network.rpcUrls.map((url) => http(url, { batch: { wait: 16 }, retryCount: 2 })),
        { rank: false },
      ),
    watchWallets: (onChange) => {
      const found = new Map<string, WalletOption>();
      const emit = () => onChange([...found.values()]);
      const onAnnounce = (event: Event) => {
        const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
        if (!detail?.provider || !detail.info) return;
        found.set(detail.info.rdns || detail.info.uuid, {
          id: detail.info.rdns || detail.info.uuid,
          name: detail.info.name,
          icon: detail.info.icon,
          provider: detail.provider,
        });
        emit();
      };
      window.addEventListener('eip6963:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      // Legacy single-provider fallback for wallets that do not announce themselves.
      const legacy = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
      const legacyTimer = window.setTimeout(() => {
        if (legacy && found.size === 0) {
          found.set('window.ethereum', { id: 'window.ethereum', name: 'Browser wallet', provider: legacy });
          emit();
        } else if (found.size === 0) {
          emit();
        }
      }, 300);
      return () => {
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        window.clearTimeout(legacyTimer);
      };
    },
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    receiptPollMs: RECEIPT_POLL_MS,
    now: () => Date.now(),
  };
}
