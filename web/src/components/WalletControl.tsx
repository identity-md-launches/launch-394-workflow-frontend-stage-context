import { useEffect, useId, useRef, useState } from 'react';
import type { WalletState } from '../wallet';
import { shortAddress } from '../format';

interface Props {
  wallet: WalletState;
  networkName: string;
  expectedChainId: number;
}

export function WalletControl({ wallet, networkName, expectedChainId }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== buttonRef.current) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector('button')?.focus();
  }, [open]);

  if (wallet.account) {
    const wrongChain = wallet.chainId !== undefined && wallet.chainId !== expectedChainId;
    return (
      <div className="wallet">
        <span className={`chip ${wrongChain ? 'chip-warning' : 'chip-ok'}`} role="status">
          <span className="chip-dot" aria-hidden="true" />
          {wrongChain ? `Wrong network (chain ${wallet.chainId})` : networkName}
        </span>
        <span className="mono wallet-address" title={wallet.account} translate="no">
          {wallet.selected?.icon ? <img className="wallet-icon" src={wallet.selected.icon} alt="" /> : null}
          {shortAddress(wallet.account)}
        </span>
        {wrongChain ? (
          <button type="button" className="btn btn-primary" onClick={() => void wallet.switchChain()} disabled={wallet.switching}>
            {wallet.switching ? 'Switching…' : `Switch to ${networkName}`}
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={wallet.disconnect}>
          Disconnect
        </button>
        {wallet.error ? (
          <p className="inline-error" role="alert">
            {wallet.error}
          </p>
        ) : null}
      </div>
    );
  }

  const single = wallet.wallets.length === 1 ? wallet.wallets[0] : undefined;
  return (
    <div className="wallet">
      {single ? (
        <button type="button" className="btn btn-primary" onClick={() => void wallet.connect(single)} disabled={wallet.connecting}>
          {wallet.connecting ? 'Connecting…' : `Connect ${single.name}`}
        </button>
      ) : wallet.wallets.length > 1 ? (
        <div className="menu-anchor">
          <button
            ref={buttonRef}
            type="button"
            className="btn btn-primary"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            disabled={wallet.connecting}
          >
            {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
          {open ? (
            <div ref={menuRef} id={menuId} className="menu" aria-label="Choose a wallet">
              {wallet.wallets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setOpen(false);
                    void wallet.connect(w);
                  }}
                >
                  {w.icon ? <img className="wallet-icon" src={w.icon} alt="" /> : null}
                  {w.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="chip chip-muted" role="status">
          {wallet.discovered ? 'No browser wallet detected' : 'Looking for wallets…'}
        </span>
      )}
      {wallet.error ? (
        <p className="inline-error" role="alert">
          {wallet.error}
        </p>
      ) : null}
    </div>
  );
}
