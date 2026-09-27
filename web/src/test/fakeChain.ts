/**
 * An in-memory EVM stand-in that speaks enough JSON-RPC (EIP-1193) for viem to run the
 * real app against it: the vault's ERC-4626 math with the six-decimal offset, the
 * seven-day donation stream, Snapshot/Donated/Deposit/Withdraw logs, receipts, blocks,
 * eth_getLogs and wallet_* chain switching. Nothing here is used in production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Abi, Address, EIP1193Provider, Hex } from 'viem';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  numberToHex,
  pad,
  toHex,
} from 'viem';
import { buildManifest } from '../../scripts/manifest-lib.mjs';

const webDir = join(__dirname, '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

export const handoff = readJson(join(webDir, 'deployment', 'handoff.json'));
export const networkFile = readJson(join(webDir, 'deployment', 'network.json'));
export const vaultAbi = readJson(join(webDir, 'public', 'abi', 'DonationVault4626.json')) as Abi;
export const tokenAbi = readJson(join(webDir, 'public', 'abi', 'LaunchToken.json')) as Abi;
export const manifest = buildManifest({
  handoff,
  networkFile,
  readAbi: (name) => readJson(join(webDir, 'public', 'abi', `${name}.json`)),
});

export const VAULT = getAddress((handoff.contracts as { name: string; address: string }[]).find((c) => c.name === 'DonationVault4626')!.address);
export const TOKEN = getAddress((handoff.contracts as { name: string; address: string }[]).find((c) => c.name === 'LaunchToken')!.address);
export const CHAIN_ID = handoff.chainId as number;
export const DEPLOY_BLOCK = 11791684n;
export const WEEK = 604_800n;
export const OFFSET = 1_000_000n;
export const ALICE = getAddress('0x00000000000000000000000000000000000a11ce');

const lower = (a: string) => a.toLowerCase();

interface RpcError {
  code: number;
  message: string;
  data?: Hex;
}

interface Log {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  removed: false;
}

interface Tx {
  hash: Hex;
  from: Address;
  to: Address;
  input: Hex;
  value: bigint;
  blockNumber: bigint;
  logs: Log[];
  status: '0x1' | '0x0';
}

export interface FakeChainOptions {
  /** Chain the wallet starts on; the public RPC is always the deployment chain. */
  walletChainId?: number;
  /** Chains the wallet already knows. */
  knownChains?: number[];
  accounts?: Address[];
  aliceBalance?: bigint;
  /** Largest eth_getLogs block span the RPC accepts before erroring. */
  maxLogRange?: bigint;
}

export class FakeChain {
  blockNumber = DEPLOY_BLOCK;
  timestamp = 1_758_900_000n;
  balances = new Map<string, bigint>();
  allowances = new Map<string, bigint>();
  shares = new Map<string, bigint>();
  shareSupply = 0n;
  lockedAmount = 0n;
  lockEnd = 0n;
  logs: Log[] = [];
  txs = new Map<Hex, Tx>();
  requests: { method: string; params: unknown }[] = [];
  walletChainId: number;
  knownChains: Set<number>;
  accounts: Address[];
  maxLogRange: bigint;
  /** When set, every eth_sendTransaction is rejected with this code (4001 = user rejected). */
  rejectSendWith: number | undefined;
  /** When set, the named vault function reverts with this custom error during eth_call/send. */
  forceRevert: { functionName: string; errorName: string } | undefined;
  private listeners = new Map<string, Set<(arg: unknown) => void>>();
  private txCounter = 0;
  readonly tokenSupply = 10n ** 27n;

  constructor(opts: FakeChainOptions = {}) {
    this.walletChainId = opts.walletChainId ?? CHAIN_ID;
    this.knownChains = new Set(opts.knownChains ?? [this.walletChainId]);
    this.accounts = opts.accounts ?? [ALICE];
    this.maxLogRange = opts.maxLogRange ?? 100_000n;
    this.balances.set(lower(ALICE), opts.aliceBalance ?? 1_000n * 10n ** 18n);
  }

  // ----- helpers -----
  advanceTime(seconds: bigint) {
    this.timestamp += seconds;
    this.blockNumber += seconds / 12n || 1n;
  }
  balanceOf(a: string) {
    return this.balances.get(lower(a)) ?? 0n;
  }
  allowance(o: string, s: string) {
    return this.allowances.get(`${lower(o)}:${lower(s)}`) ?? 0n;
  }
  sharesOf(a: string) {
    return this.shares.get(lower(a)) ?? 0n;
  }
  unvested(): bigint {
    if (this.timestamp >= this.lockEnd) return 0n;
    return (this.lockedAmount * (this.lockEnd - this.timestamp)) / WEEK;
  }
  totalAssets(): bigint {
    return this.balanceOf(VAULT) - this.unvested();
  }
  toShares(assets: bigint, roundUp = false): bigint {
    const n = assets * (this.shareSupply + OFFSET);
    const d = this.totalAssets() + 1n;
    return roundUp ? (n + d - 1n) / d : n / d;
  }
  toAssets(shares: bigint, roundUp = false): bigint {
    const n = shares * (this.totalAssets() + 1n);
    const d = this.shareSupply + OFFSET;
    return roundUp ? (n + d - 1n) / d : n / d;
  }
  snapshots() {
    return this.logs.filter((l) => l.address === VAULT && l.topics[0] === encodeEventTopics({ abi: vaultAbi, eventName: 'Snapshot' })[0]);
  }

  /** The EIP-1193 provider used for both the public RPC transport and the wallet. */
  provider(): EIP1193Provider {
    const self = this;
    return {
      request: (async (args: { method: string; params?: unknown }) => self.request(args.method, args.params)) as EIP1193Provider['request'],
      on: ((event: string, fn: (arg: unknown) => void) => {
        if (!self.listeners.has(event)) self.listeners.set(event, new Set());
        self.listeners.get(event)!.add(fn);
      }) as EIP1193Provider['on'],
      removeListener: ((event: string, fn: (arg: unknown) => void) => {
        self.listeners.get(event)?.delete(fn);
      }) as EIP1193Provider['removeListener'],
    };
  }

  emit(event: string, arg: unknown) {
    this.listeners.get(event)?.forEach((fn) => fn(arg));
  }

  // ----- JSON-RPC -----
  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_chainId':
        return numberToHex(this.walletChainId);
      case 'net_version':
        return String(this.walletChainId);
      case 'eth_blockNumber':
        return numberToHex(this.blockNumber);
      case 'eth_getBlockByNumber':
        return this.block(p[0] === 'latest' || p[0] === 'pending' || p[0] === 'safe' || p[0] === 'finalized' ? this.blockNumber : BigInt(p[0] as string));
      case 'eth_getBlockByHash':
        return this.block(this.blockNumber);
      case 'eth_call':
        return this.call(p[0] as { from?: Address; to: Address; data: Hex }, false);
      case 'eth_estimateGas':
        this.call(p[0] as { from?: Address; to: Address; data: Hex }, false);
        return '0x186a0';
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_getTransactionCount':
        return '0x1';
      case 'eth_sendTransaction':
        return this.sendTransaction(p[0] as { from: Address; to: Address; data: Hex; value?: Hex });
      case 'eth_getTransactionReceipt':
        return this.receipt(p[0] as Hex);
      case 'eth_getTransactionByHash':
        return this.transaction(p[0] as Hex);
      case 'eth_getLogs':
        return this.getLogs(p[0] as { address?: Address; topics?: (Hex | null)[]; fromBlock?: Hex; toBlock?: Hex });
      case 'eth_getCode':
        return lower(p[0] as string) === lower(VAULT) || lower(p[0] as string) === lower(TOKEN) ? '0x6001' : '0x';
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return this.accounts;
      case 'wallet_switchEthereumChain': {
        const id = Number((p[0] as { chainId: Hex }).chainId);
        if (!this.knownChains.has(id)) throw this.rpcError(4902, 'Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.');
        this.walletChainId = id;
        this.emit('chainChanged', numberToHex(id));
        return null;
      }
      case 'wallet_addEthereumChain': {
        const id = Number((p[0] as { chainId: Hex }).chainId);
        this.knownChains.add(id);
        return null;
      }
      default:
        throw this.rpcError(-32601, `Method ${method} not supported by FakeChain`);
    }
  }

  private rpcError(code: number, message: string, data?: Hex): RpcError & Error {
    const e = new Error(message) as RpcError & Error;
    e.code = code;
    if (data) e.data = data;
    return e;
  }

  private revert(abi: Abi, errorName: string, args: unknown[] = []): never {
    throw this.rpcError(3, 'execution reverted', encodeErrorResult({ abi, errorName, args }));
  }

  private block(number: bigint) {
    const hash = keccak256(toHex(`block-${number}`));
    return {
      number: numberToHex(number),
      hash,
      parentHash: keccak256(toHex(`block-${number - 1n}`)),
      timestamp: numberToHex(this.timestamp - (this.blockNumber - number) * 12n),
      nonce: '0x0000000000000000',
      difficulty: '0x0',
      totalDifficulty: '0x0',
      gasLimit: '0x1c9c380',
      gasUsed: '0x5208',
      baseFeePerGas: '0x3b9aca00',
      miner: '0x0000000000000000000000000000000000000000',
      extraData: '0x',
      logsBloom: `0x${'0'.repeat(512)}`,
      mixHash: pad('0x0', { size: 32 }),
      receiptsRoot: pad('0x0', { size: 32 }),
      sha3Uncles: pad('0x0', { size: 32 }),
      stateRoot: pad('0x0', { size: 32 }),
      transactionsRoot: pad('0x0', { size: 32 }),
      size: '0x100',
      transactions: [],
      uncles: [],
    };
  }

  private receipt(hash: Hex) {
    const tx = this.txs.get(hash);
    if (!tx) return null;
    return {
      transactionHash: tx.hash,
      transactionIndex: '0x0',
      blockHash: keccak256(toHex(`block-${tx.blockNumber}`)),
      blockNumber: numberToHex(tx.blockNumber),
      from: tx.from,
      to: tx.to,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      contractAddress: null,
      logs: tx.logs,
      logsBloom: `0x${'0'.repeat(512)}`,
      status: tx.status,
      type: '0x2',
    };
  }

  private transaction(hash: Hex) {
    const tx = this.txs.get(hash);
    if (!tx) return null;
    return {
      hash: tx.hash,
      nonce: '0x1',
      blockHash: keccak256(toHex(`block-${tx.blockNumber}`)),
      blockNumber: numberToHex(tx.blockNumber),
      transactionIndex: '0x0',
      from: tx.from,
      to: tx.to,
      value: numberToHex(tx.value),
      gas: '0x186a0',
      gasPrice: '0x3b9aca00',
      input: tx.input,
      v: '0x1',
      r: '0x1',
      s: '0x1',
      type: '0x2',
      chainId: numberToHex(CHAIN_ID),
      maxFeePerGas: '0x3b9aca00',
      maxPriorityFeePerGas: '0x3b9aca00',
      accessList: [],
    };
  }

  private getLogs(filter: { address?: Address; topics?: (Hex | null)[]; fromBlock?: Hex; toBlock?: Hex }) {
    const fromTag = filter.fromBlock as string | undefined;
    const toTag = filter.toBlock as string | undefined;
    const from = fromTag && fromTag.startsWith('0x') ? BigInt(fromTag) : 0n;
    const to = toTag && toTag.startsWith('0x') ? BigInt(toTag) : this.blockNumber;
    if (to - from + 1n > this.maxLogRange) throw this.rpcError(-32005, 'query returned more than 10000 results');
    return this.logs.filter((l) => {
      if (filter.address && lower(l.address) !== lower(filter.address)) return false;
      const n = BigInt(l.blockNumber);
      if (n < from || n > to) return false;
      const t0 = filter.topics?.[0];
      if (t0 && l.topics[0] !== t0) return false;
      return true;
    });
  }

  private sendTransaction(tx: { from: Address; to: Address; data: Hex; value?: Hex }) {
    if (this.rejectSendWith !== undefined) throw this.rpcError(this.rejectSendWith, 'User rejected the request.');
    if (this.walletChainId !== CHAIN_ID) throw this.rpcError(-32000, 'wrong chain for this transaction');
    this.blockNumber += 1n;
    this.timestamp += 12n;
    const hash = keccak256(toHex(`tx-${++this.txCounter}`));
    const record: Tx = { hash, from: getAddress(tx.from), to: getAddress(tx.to), input: tx.data, value: BigInt(tx.value ?? '0x0'), blockNumber: this.blockNumber, logs: [], status: '0x1' };
    this.txs.set(hash, record);
    this.call(tx, true, record);
    return hash;
  }

  private emitLog(record: Tx | undefined, address: Address, abi: Abi, eventName: string, args: Record<string, unknown>) {
    if (!record) return;
    const item = abi.find((x) => x.type === 'event' && x.name === eventName);
    if (!item || item.type !== 'event') throw new Error(`no event ${eventName}`);
    const topics = encodeEventTopics({ abi, eventName, args } as Parameters<typeof encodeEventTopics>[0]);
    const nonIndexed = item.inputs.filter((i) => !i.indexed);
    const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name as string]) as never);
    const log: Log = {
      address,
      topics: topics as Hex[],
      data,
      blockNumber: numberToHex(record.blockNumber),
      blockHash: keccak256(toHex(`block-${record.blockNumber}`)),
      transactionHash: record.hash,
      transactionIndex: '0x0',
      logIndex: numberToHex(this.logs.length),
      removed: false,
    };
    this.logs.push(log);
    record.logs.push(log);
  }

  private transferToken(from: string, to: string, amount: bigint, record?: Tx) {
    const bal = this.balanceOf(from);
    if (bal < amount) this.revert(tokenAbi, 'ERC20InsufficientBalance', [getAddress(from), bal, amount]);
    this.balances.set(lower(from), bal - amount);
    this.balances.set(lower(to), this.balanceOf(to) + amount);
    this.emitLog(record, TOKEN, tokenAbi, 'Transfer', { from: getAddress(from), to: getAddress(to), value: amount });
  }

  private spendAllowance(owner: string, spender: string, amount: bigint) {
    const a = this.allowance(owner, spender);
    if (a < amount) this.revert(tokenAbi, 'ERC20InsufficientAllowance', [getAddress(spender), a, amount]);
    this.allowances.set(`${lower(owner)}:${lower(spender)}`, a - amount);
  }

  private snapshot(record?: Tx) {
    this.emitLog(record, VAULT, vaultAbi, 'Snapshot', { totalAssets: this.totalAssets(), totalSupply: this.shareSupply });
  }

  /** Execute a call against the token or vault. `mutate` distinguishes eth_call from a mined tx. */
  private call(tx: { from?: Address; to: Address; data: Hex }, mutate: boolean, record?: Tx): Hex {
    const to = lower(tx.to);
    const from = tx.from ? getAddress(tx.from) : '0x0000000000000000000000000000000000000000';
    if (to === lower(TOKEN)) {
      const { functionName, args = [] } = decodeFunctionData({ abi: tokenAbi, data: tx.data });
      const a = args as unknown[];
      const result = (value: unknown) => encodeFunctionResult({ abi: tokenAbi, functionName, result: value } as Parameters<typeof encodeFunctionResult>[0]);
      switch (functionName) {
        case 'name':
          return result('Piggy');
        case 'symbol':
          return result('PIGY');
        case 'decimals':
          return result(18);
        case 'totalSupply':
          return result(this.tokenSupply);
        case 'balanceOf':
          return result(this.balanceOf(a[0] as string));
        case 'allowance':
          return result(this.allowance(a[0] as string, a[1] as string));
        case 'approve': {
          const [spender, amount] = a as [Address, bigint];
          if (mutate) {
            this.allowances.set(`${lower(from)}:${lower(spender)}`, amount);
            this.emitLog(record, TOKEN, tokenAbi, 'Approval', { owner: from, spender: getAddress(spender), value: amount });
          }
          return result(true);
        }
        case 'transfer': {
          const [dst, amount] = a as [Address, bigint];
          const snapshot = mutate ? undefined : new Map(this.balances);
          this.transferToken(from, dst, amount, record);
          if (snapshot) this.balances = snapshot;
          return result(true);
        }
        default:
          throw new Error(`FakeChain token: ${functionName} not implemented`);
      }
    }
    if (to === lower(VAULT)) {
      const { functionName, args = [] } = decodeFunctionData({ abi: vaultAbi, data: tx.data });
      const a = args as unknown[];
      const result = (value: unknown) => encodeFunctionResult({ abi: vaultAbi, functionName, result: value } as Parameters<typeof encodeFunctionResult>[0]);
      if (this.forceRevert && this.forceRevert.functionName === functionName) this.revert(vaultAbi, this.forceRevert.errorName);
      switch (functionName) {
        case 'name':
          return result('Piggy Vault');
        case 'symbol':
          return result('vPIGY');
        case 'decimals':
          return result(24);
        case 'token':
        case 'asset':
          return result(TOKEN);
        case 'totalAssets':
          return result(this.totalAssets());
        case 'totalSupply':
          return result(this.shareSupply);
        case 'sharePrice':
          return result(this.toAssets(10n ** 24n));
        case 'unvested':
          return result(this.unvested());
        case 'lockedAmount':
          return result(this.lockedAmount);
        case 'lockEnd':
          return result(this.lockEnd);
        case 'UNLOCK_DURATION':
          return result(WEEK);
        case 'balanceOf':
        case 'maxRedeem':
          return result(this.sharesOf(a[0] as string));
        case 'convertToAssets':
        case 'previewRedeem':
          return result(this.toAssets(a[0] as bigint));
        case 'convertToShares':
        case 'previewDeposit':
          return result(this.toShares(a[0] as bigint));
        case 'allowance':
          return result(0n);
        case 'deposit': {
          const [assets, receiver] = a as [bigint, Address];
          const shares = this.toShares(assets);
          if (shares === 0n) this.revert(vaultAbi, 'ZeroShares');
          if (!mutate) {
            this.spendAllowanceCheck(from, assets);
            return result(shares);
          }
          this.spendAllowance(from, VAULT, assets);
          this.transferToken(from, VAULT, assets, record);
          this.shares.set(lower(receiver), this.sharesOf(receiver) + shares);
          this.shareSupply += shares;
          this.emitLog(record, VAULT, vaultAbi, 'Deposit', { sender: from, owner: getAddress(receiver), assets, shares });
          this.snapshot(record);
          return result(shares);
        }
        case 'redeem': {
          const [shares, receiver, owner] = a as [bigint, Address, Address];
          const max = this.sharesOf(owner);
          if (shares > max) this.revert(vaultAbi, 'ERC4626ExceededMaxRedeem', [getAddress(owner), shares, max]);
          if (lower(receiver) !== lower(from)) this.revert(vaultAbi, 'ReceiverMustBeCaller');
          const assets = this.toAssets(shares);
          if (!mutate) return result(assets);
          this.shares.set(lower(owner), max - shares);
          this.shareSupply -= shares;
          this.transferToken(VAULT, receiver, assets, record);
          this.emitLog(record, VAULT, vaultAbi, 'Withdraw', { sender: from, receiver: getAddress(receiver), owner: getAddress(owner), assets, shares });
          this.snapshot(record);
          return result(assets);
        }
        case 'donate': {
          const [amount] = a as [bigint];
          if (amount === 0n) this.revert(vaultAbi, 'ZeroDonation');
          if (!mutate) {
            this.spendAllowanceCheck(from, amount);
            return result(undefined);
          }
          const remaining = this.unvested();
          this.spendAllowance(from, VAULT, amount);
          this.transferToken(from, VAULT, amount, record);
          this.lockedAmount = remaining + amount;
          this.lockEnd = this.timestamp + WEEK;
          this.emitLog(record, VAULT, vaultAbi, 'Donated', { donor: from, amount, lockEnd: this.lockEnd });
          this.snapshot(record);
          return '0x';
        }
        default:
          throw new Error(`FakeChain vault: ${functionName} not implemented`);
      }
    }
    throw this.rpcError(-32000, `no contract at ${tx.to}`);
  }

  private spendAllowanceCheck(from: string, amount: bigint) {
    const al = this.allowance(from, VAULT);
    if (al < amount) this.revert(tokenAbi, 'ERC20InsufficientAllowance', [VAULT, al, amount]);
    const bal = this.balanceOf(from);
    if (bal < amount) this.revert(tokenAbi, 'ERC20InsufficientBalance', [getAddress(from), bal, amount]);
  }
}
