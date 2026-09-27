import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Address, PublicClient, WalletClient } from 'viem';
import type { Deployment } from '../deployment';
import { formatAmount, formatExact, parseAmount } from '../format';
import { useTransaction } from '../hooks/useTransaction';
import { previewDeposit, previewRedeem, type VaultSnapshotState, type WalletPosition } from '../vault';
import { TxStatusLine } from './TxStatusLine';

export type ActionKind = 'deposit' | 'redeem' | 'donate';

interface Props {
  kind: ActionKind;
  deployment: Deployment;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Address;
  onCorrectChain: boolean;
  vault: VaultSnapshotState;
  position?: WalletPosition;
  receiptPollMs: number;
  onConfirmed: () => Promise<void>;
}

const copy: Record<ActionKind, { title: string; description: string; verb: string; inputLabel: string }> = {
  deposit: {
    title: 'Deposit',
    description: 'Lock PIGY in the vault and receive vPIGY shares. Shares grow in value as donations vest.',
    verb: 'Deposit',
    inputLabel: 'Amount to deposit',
  },
  redeem: {
    title: 'Redeem',
    description: 'Burn vPIGY shares and receive their current PIGY value. Payout goes to the connected wallet.',
    verb: 'Redeem',
    inputLabel: 'Shares to redeem',
  },
  donate: {
    title: 'Donate',
    description: 'Give PIGY to all shareholders. Donations unlock linearly over seven days; a new donation merges with the remaining stream and restarts the clock.',
    verb: 'Donate',
    inputLabel: 'Amount to donate',
  },
};

export function ActionForm(props: Props) {
  const { kind, deployment, publicClient, walletClient, account, onCorrectChain, vault, position, receiptPollMs, onConfirmed } = props;
  const text = copy[kind];
  const inputId = useId();
  const errorId = useId();
  const previewId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState('');
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<{ for: bigint; value: bigint } | null>(null);
  const [previewError, setPreviewError] = useState<string>();

  const isShares = kind === 'redeem';
  const decimals = isShares ? vault.shareDecimals : vault.assetDecimals;
  const symbol = isShares ? vault.shareSymbol : vault.assetSymbol;
  const outSymbol = isShares ? vault.assetSymbol : vault.shareSymbol;
  const outDecimals = isShares ? vault.assetDecimals : vault.shareDecimals;

  const parsed = useMemo(() => parseAmount(raw, decimals, symbol), [raw, decimals, symbol]);
  const amount = parsed.value;
  const available = position ? (isShares ? position.maxRedeem : position.tokenBalance) : undefined;
  const needsApproval = !isShares && amount !== undefined && position !== undefined && position.allowance < amount;
  const exceeds = amount !== undefined && available !== undefined && amount > available;

  const tx = useTransaction(publicClient, walletClient, account, receiptPollMs, onConfirmed);

  // Preview the result of the action from the contract itself (debounced).
  useEffect(() => {
    if (amount === undefined || kind === 'donate') {
      setPreview(null);
      setPreviewError(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const value = isShares ? await previewRedeem(publicClient, deployment, amount) : await previewDeposit(publicClient, deployment, amount);
        if (cancelled) return;
        setPreview({ for: amount, value });
        setPreviewError(!isShares && value === 0n ? 'This amount is too small to mint any shares. Enter a larger deposit.' : undefined);
      } catch {
        if (!cancelled) setPreviewError('Unable to preview right now. The action can still be checked before signing.');
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, kind, isShares, publicClient, deployment]);

  // Format errors wait for blur/submit so typing is not nagged; an over-balance amount is shown at once,
  // because the action button is disabled for it and needs a visible reason.
  const fieldError = parsed.error ? (touched ? parsed.error : undefined) : exceeds ? `That is more ${symbol} than the wallet holds.` : undefined;

  const blocker = !account
    ? 'Connect a wallet to continue.'
    : !onCorrectChain
      ? `Switch the wallet to ${deployment.network.name} to continue.`
      : undefined;

  const approveLabel = amount !== undefined ? `Approve ${formatAmount(amount, decimals)} ${symbol}` : `Approve ${symbol}`;
  const actionLabel = amount !== undefined ? `${text.verb} ${formatAmount(amount, decimals)} ${symbol}` : `${text.verb} ${symbol}`;

  const canApprove = Boolean(needsApproval && !exceeds && !parsed.error && !blocker && !tx.busy);
  const canAct = Boolean(amount !== undefined && !parsed.error && !exceeds && !needsApproval && !blocker && !tx.busy && !(kind === 'deposit' && preview?.for === amount && preview.value === 0n));

  const approve = async () => {
    if (!amount || !canApprove) return;
    await tx.send({
      label: approveLabel,
      address: vault.asset,
      abi: deployment.token.abi,
      functionName: 'approve',
      args: [deployment.vault.address, amount],
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.error || exceeds) {
      inputRef.current?.focus();
      return;
    }
    if (!amount || !account) return;
    if (needsApproval) {
      await approve();
      return;
    }
    if (!canAct) return;
    const args = kind === 'deposit' ? [amount, account] : kind === 'redeem' ? [amount, account, account] : [amount];
    const ok = await tx.send({ label: actionLabel, address: deployment.vault.address, abi: deployment.vault.abi, functionName: kind, args });
    if (ok) {
      setRaw('');
      setTouched(false);
    }
  };

  const setMax = () => {
    if (available === undefined) return;
    setRaw(formatExact(available, decimals));
    setTouched(true);
  };

  return (
    <form className="card action" onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`}>{text.title}</h3>
      <p className="muted">{text.description}</p>

      <div className="field">
        <div className="field-head">
          <label htmlFor={inputId}>{text.inputLabel}</label>
          {available !== undefined ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={setMax} disabled={available === 0n}>
              Max: {formatAmount(available, decimals)} {symbol}
            </button>
          ) : null}
        </div>
        <div className="input-wrap">
          <input
            ref={inputRef}
            id={inputId}
            className="input num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(raw !== '')}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={`${fieldError ? errorId : ''} ${previewId}`.trim()}
            disabled={tx.busy}
          />
          <span className="input-unit" aria-hidden="true">
            {symbol}
          </span>
        </div>
        {fieldError ? (
          <p id={errorId} className="inline-error">
            {fieldError}
          </p>
        ) : null}
        <p id={previewId} className="preview num">
          {kind === 'donate' ? (
            amount !== undefined ? (
              <>Unlocks over 7 days to all shareholders; nothing is returned to you.</>
            ) : (
              <>Donations reward current and future shareholders.</>
            )
          ) : preview && preview.for === amount ? (
            <>
              You receive about <strong title={formatExact(preview.value, outDecimals)}>{formatAmount(preview.value, outDecimals, 6)}</strong> {outSymbol}
              {previewError ? ` — ${previewError}` : ''}
            </>
          ) : amount !== undefined ? (
            <>Previewing…</>
          ) : (
            <>Enter an amount to preview {isShares ? `the ${outSymbol} you receive` : `the ${outSymbol} shares you receive`}.</>
          )}
        </p>
      </div>

      {position && !isShares ? (
        <p className="muted small">
          Allowance to the vault: <span className="num" title={formatExact(position.allowance, decimals)}>{formatAmount(position.allowance, decimals)}</span> {symbol}
        </p>
      ) : null}

      <div className="actions">
        {!isShares ? (
          <button type="button" className={`btn ${needsApproval ? 'btn-primary' : 'btn-secondary'}`} onClick={() => void approve()} disabled={!canApprove}>
            <span className="step" aria-hidden="true">1</span> {approveLabel}
          </button>
        ) : null}
        <button type="submit" className={`btn ${needsApproval ? 'btn-secondary' : 'btn-primary'}`} disabled={!canAct && !(amount === undefined && !blocker && !tx.busy)}>
          {!isShares ? (
            <span className="step" aria-hidden="true">
              2
            </span>
          ) : null}{' '}
          {actionLabel}
        </button>
      </div>
      {blocker ? <p className="muted small">{blocker}</p> : null}
      {!blocker && needsApproval ? (
        <p className="muted small">Approve the vault to spend this amount first, then {text.verb.toLowerCase()}.</p>
      ) : null}

      <TxStatusLine status={tx.status} txUrl={(h) => deployment.explorerUrl('tx', h)} onDismiss={tx.reset} />
    </form>
  );
}
