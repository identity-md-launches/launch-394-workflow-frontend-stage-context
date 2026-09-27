import { custom } from 'viem';
import type { Env, WalletOption } from '../env';
import { FakeChain, manifest, vaultAbi, tokenAbi } from './fakeChain';

/** Build an Env whose RPC, manifest fetch and wallet all point at one FakeChain. */
export function testEnv(chain: FakeChain, opts: { wallets?: WalletOption[] | 'none' } = {}): Env {
  const wallets: WalletOption[] =
    opts.wallets === 'none' ? [] : (opts.wallets ?? [{ id: 'fake', name: 'Fake Wallet', provider: chain.provider() }]);
  return {
    fetchJson: async (path) => {
      if (path === 'imd-deployment.json') return structuredClone(manifest);
      if (path === 'abi/DonationVault4626.json') return structuredClone(vaultAbi);
      if (path === 'abi/LaunchToken.json') return structuredClone(tokenAbi);
      throw new Error(`unexpected fetch ${path}`);
    },
    publicTransport: () => custom(chain.provider(), { retryCount: 0 }),
    watchWallets: (onChange) => {
      onChange(wallets);
      return () => {};
    },
    refreshIntervalMs: 60_000,
    receiptPollMs: 5,
    now: () => Number(chain.timestamp) * 1000,
  };
}
