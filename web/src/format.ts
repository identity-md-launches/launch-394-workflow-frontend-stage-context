import { formatUnits, parseUnits } from 'viem';

/**
 * Format a token amount for display: grouped integer part, at most `maxFraction`
 * fraction digits, trailing zeros trimmed. Tiny nonzero values show as "< 0.0001".
 */
export function formatAmount(value: bigint | undefined, decimals: number, maxFraction = 4): string {
  if (value === undefined) return '…';
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = formatUnits(abs, decimals);
  const [intPart = '0', fracPart = ''] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fracPart.slice(0, maxFraction).replace(/0+$/, '');
  if (abs > 0n && grouped === '0' && frac === '') {
    return `< 0.${'0'.repeat(Math.max(maxFraction - 1, 0))}1`;
  }
  frac = frac ? `.${frac}` : '';
  return `${negative ? '-' : ''}${grouped}${frac}`;
}

/** Exact decimal string, for tooltips and tables. */
export function formatExact(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return '';
  return formatUnits(value, decimals);
}

export interface ParsedAmount {
  value?: bigint;
  error?: string;
}

/** Parse a user-typed decimal amount into minor units, with a human error message. */
export function parseAmount(input: string, decimals: number, symbol: string): ParsedAmount {
  const text = input.trim().replace(/,/g, '');
  if (text === '') return { error: `Enter an amount of ${symbol}.` };
  if (!/^\d*\.?\d*$/.test(text) || text === '.') return { error: `Use digits and one decimal point, for example 12.5.` };
  const frac = text.split('.')[1] ?? '';
  if (frac.length > decimals) return { error: `${symbol} supports at most ${decimals} decimal places.` };
  const value = parseUnits(text, decimals);
  if (value <= 0n) return { error: `Enter an amount greater than zero.` };
  return { value };
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function formatTimestamp(seconds: bigint | number): string {
  return dateFormat.format(new Date(Number(seconds) * 1000));
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 min';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (!days && minutes) parts.push(`${minutes} min`);
  if (parts.length === 0) parts.push('< 1 min');
  return parts.join(' ');
}

/** Codes, decoded custom-error names and messages gathered from an error's whole cause chain. */
function errorDetails(error: unknown): { code?: number; all: string } {
  const chain: string[] = [];
  let code: number | undefined;
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 8; depth++) {
    const c = cur as { code?: number; message?: string; shortMessage?: string; details?: string; reason?: string; data?: { errorName?: string }; cause?: unknown };
    if (code === undefined && typeof c.code === 'number') code = c.code;
    for (const part of [c.data?.errorName, c.reason, c.shortMessage, c.details, c.message]) if (typeof part === 'string') chain.push(part);
    cur = c.cause;
  }
  return { ...(code !== undefined ? { code } : {}), all: chain.join('\n') };
}

/** True when the visitor declined the request in the wallet (EIP-1193 code 4001). */
export function isUserRejection(error: unknown): boolean {
  const { code, all } = errorDetails(error);
  return code === 4001 || /user rejected|user denied|rejected the request/i.test(all);
}

/** Human explanation for a wallet or RPC error, with the raw reason kept short. */
export function describeError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; details?: string };
  const { all } = errorDetails(error);
  if (isUserRejection(error)) return 'Request cancelled in the wallet. Nothing was sent.';
  const text = e?.shortMessage ?? e?.details ?? e?.message ?? String(error);
  const known: [RegExp, string][] = [
    [/ZeroShares/, 'This amount is too small to mint any shares. Enter a larger deposit.'],
    [/ZeroDonation/, 'Enter a donation greater than zero.'],
    [/ReceiverMustBeCaller/, 'Withdrawals pay the connected wallet only.'],
    [/ERC20InsufficientAllowance/, 'The vault is not approved for this amount yet. Approve first.'],
    [/ERC20InsufficientBalance/, 'The wallet does not hold enough for this amount.'],
    [/ERC4626ExceededMaxRedeem/, 'The amount exceeds the shares the wallet holds.'],
    [/ERC4626ExceededMaxWithdraw/, 'The amount exceeds what the wallet can withdraw.'],
    [/insufficient funds/i, 'Not enough Sepolia ETH to pay for gas.'],
    [/chain.*mismatch|does not match the target chain/i, 'The wallet is on a different network. Switch networks and try again.'],
  ];
  for (const [re, msg] of known) if (re.test(all)) return msg;
  const firstLine = text.split('\n')[0] ?? text;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
