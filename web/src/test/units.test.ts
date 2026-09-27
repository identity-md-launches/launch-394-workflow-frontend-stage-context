import { describe, expect, it } from 'vitest';
import { createPublicClient, custom } from 'viem';
import { abiHashOf, buildManifest, canonicalJson } from '../../scripts/manifest-lib.mjs';
import { formatAmount, formatDuration, parseAmount } from '../format';
import { chainFromNetwork, loadDeployment, parseManifest, walletAddChainParams } from '../deployment';
import { scanSnapshots } from '../snapshots';
import { priceFromSnapshot, unvestedAt } from '../vault';
import { ALICE, DEPLOY_BLOCK, FakeChain, VAULT, handoff, manifest, networkFile, tokenAbi, vaultAbi } from './fakeChain';
import { testEnv } from './testEnv';
import { encodeFunctionData } from 'viem';

describe('manifest generation', () => {
  it('reproduces the handoff ABI hashes with canonical JSON keccak', () => {
    expect(abiHashOf(vaultAbi)).toBe('7e1d1b0a8c450d2f3fe7f5eaf0b7204d80c2c7834642cd7f2a1aa7de17b5ed63');
    expect(abiHashOf(tokenAbi)).toBe('38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee');
    expect(canonicalJson({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
  });

  it('copies identifiers and the network block from the handoff files', () => {
    expect(manifest).toMatchObject({
      version: 1,
      launchId: handoff.launchId,
      chainId: 11155111,
      sourceCommit: handoff.sourceCommit,
      attestationHash: handoff.attestationHash,
    });
    expect(manifest.network).toEqual(networkFile.network);
    expect(manifest.contracts).toEqual([
      { name: 'LaunchToken', address: '0x45f5bc74c61718d49225b54ec12a78714a7beecb', abiHash: '38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee', abiPath: 'abi/LaunchToken.json' },
      { name: 'DonationVault4626', address: '0xbfa4a44c30f443bdc635325877a6686d7cddafc6', abiHash: '7e1d1b0a8c450d2f3fe7f5eaf0b7204d80c2c7834642cd7f2a1aa7de17b5ed63', abiPath: 'abi/DonationVault4626.json' },
    ]);
  });

  it('refuses an ABI that does not match the attested hash', () => {
    const tampered = [...(vaultAbi as unknown[]), { type: 'function', name: 'sweep', inputs: [], outputs: [], stateMutability: 'nonpayable' }];
    expect(() =>
      buildManifest({ handoff, networkFile, readAbi: (name: string) => (name === 'DonationVault4626' ? tampered : tokenAbi) }),
    ).toThrow(/ABI hash mismatch for DonationVault4626/);
  });
});

describe('runtime deployment parsing', () => {
  it('accepts the generated manifest and rejects traversal or absolute ABI paths', () => {
    expect(parseManifest(manifest).chainId).toBe(11155111);
    const bad = structuredClone(manifest) as typeof manifest & { contracts: { abiPath: string }[] };
    bad.contracts[0]!.abiPath = '../abi/x.json';
    expect(() => parseManifest(bad)).toThrow(/bad abiPath/);
    bad.contracts[0]!.abiPath = 'https://example.com/abi.json';
    expect(() => parseManifest(bad)).toThrow(/bad abiPath/);
  });

  it('derives the viem chain and wallet_addEthereumChain params from the network block', async () => {
    const dep = await loadDeployment(testEnv(new FakeChain()).fetchJson);
    expect(dep.vault.address).toBe(VAULT.toLowerCase());
    expect(dep.chain.id).toBe(11155111);
    expect(dep.chain.rpcUrls.default.http).toEqual(networkFile.network.rpcUrls);
    expect(chainFromNetwork(dep.network).blockExplorers?.default.url).toBe('https://sepolia.etherscan.io');
    expect(walletAddChainParams(dep.network)).toEqual(networkFile.walletAddChain);
    expect(dep.explorerUrl('tx', '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc');
  });
});

describe('formatting', () => {
  it('formats amounts with grouping, trimmed fractions and a floor for dust', () => {
    expect(formatAmount(1_234_567n * 10n ** 18n, 18)).toBe('1,234,567');
    expect(formatAmount(15n * 10n ** 17n, 18)).toBe('1.5');
    expect(formatAmount(1n, 18)).toBe('< 0.0001');
    expect(formatAmount(0n, 24)).toBe('0');
    expect(formatAmount(undefined, 18)).toBe('…');
  });

  it('parses user input with actionable errors', () => {
    expect(parseAmount(' 12.5 ', 18, 'PIGY').value).toBe(125n * 10n ** 17n);
    expect(parseAmount('1,000', 18, 'PIGY').value).toBe(1000n * 10n ** 18n);
    expect(parseAmount('', 18, 'PIGY').error).toMatch(/Enter an amount/);
    expect(parseAmount('0', 18, 'PIGY').error).toMatch(/greater than zero/);
    expect(parseAmount('1e5', 18, 'PIGY').error).toMatch(/digits/);
    expect(parseAmount('0.0000000000000000001', 18, 'PIGY').error).toMatch(/at most 18 decimal/);
  });

  it('formats durations', () => {
    expect(formatDuration(7 * 86400)).toBe('7 d');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(formatDuration(2 * 86400 + 3 * 3600 + 5 * 60)).toBe('2 d 3 h');
    expect(formatDuration(59)).toBe('< 1 min');
  });
});

describe('vault math', () => {
  it('matches the documented Snapshot price and stream formulas', () => {
    expect(priceFromSnapshot(0n, 0n)).toBe(10n ** 18n);
    expect(priceFromSnapshot(20n * 10n ** 18n, 10n * 10n ** 24n)).toBe((10n ** 24n * (20n * 10n ** 18n + 1n)) / (10n * 10n ** 24n + 1_000_000n));
    expect(unvestedAt(70n, 1000n, 700n, 300n)).toBe(70n);
    expect(unvestedAt(70n, 1000n, 700n, 650n)).toBe(35n);
    expect(unvestedAt(70n, 1000n, 700n, 1000n)).toBe(0n);
  });
});

describe('snapshot scanning', () => {
  it('chunks eth_getLogs from the deployment block and halves the range when the RPC rejects it', async () => {
    const chain = new FakeChain({ maxLogRange: 3_000n });
    chain.allowances.set(`${ALICE.toLowerCase()}:${VAULT.toLowerCase()}`, 10n ** 30n);
    for (const n of [1n, 2n, 3n]) {
      chain.advanceTime(12n * 4_000n); // spread events across several chunks
      await chain.request('eth_sendTransaction', [{ from: ALICE, to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [n * 10n ** 18n, ALICE] }) }]);
    }
    const dep = await loadDeployment(testEnv(chain).fetchJson);
    const client = createPublicClient({ chain: dep.chain, transport: custom(chain.provider(), { retryCount: 0 }) });
    const result = await scanSnapshots(client, dep, DEPLOY_BLOCK);
    expect(result.points).toHaveLength(3);
    expect(result.points.map((p) => p.totalSupply)).toEqual([10n ** 24n, 3n * 10n ** 24n, 6n * 10n ** 24n]);
    expect(result.points.every((p) => p.timestamp > 0n)).toBe(true);
    expect(result.scannedTo).toBe(chain.blockNumber);
    const ranges = chain.requests
      .filter((r) => r.method === 'eth_getLogs')
      .map((r) => {
        const f = (r.params as [{ fromBlock: string; toBlock: string }])[0];
        return BigInt(f.toBlock) - BigInt(f.fromBlock) + 1n;
      });
    // 10,000 rejected → 5,000 rejected → 2,500 accepted, and never widened again.
    expect(ranges.slice(0, 3)).toEqual([10_000n, 5_000n, 2_500n]);
    expect(Math.max(...ranges.slice(2).map(Number))).toBeLessThanOrEqual(2_500);
    expect(ranges.length).toBeGreaterThan(6);
  });
});
