import { useEffect, useMemo, useState } from 'react';
import { createPublicClient, type PublicClient } from 'viem';
import { ActionForm } from './components/ActionForm';
import { AddressLink } from './components/AddressLink';
import { GetPigy } from './components/GetPigy';
import { PriceChart } from './components/PriceChart';
import { Stat } from './components/Stat';
import { WalletControl } from './components/WalletControl';
import { loadDeployment, type Deployment } from './deployment';
import type { Env } from './env';
import { describeError, formatAmount, formatDuration, formatExact, formatTimestamp } from './format';
import { useVaultData } from './hooks/useVaultData';
import { unvestedAt } from './vault';
import { useWallet } from './wallet';

interface Props {
  env: Env;
}

export function App({ env }: Props) {
  const [deployment, setDeployment] = useState<Deployment>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadDeployment(env.fetchJson)
      .then((d) => {
        if (!cancelled) setDeployment(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(describeError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [env]);

  const publicClient = useMemo<PublicClient | undefined>(
    () => (deployment ? createPublicClient({ chain: deployment.chain, transport: env.publicTransport(deployment.network) }) : undefined),
    [deployment, env],
  );

  const wallet = useWallet(env, deployment);
  const data = useVaultData(env, publicClient, deployment, wallet.account);
  const onCorrectChain = deployment !== undefined && wallet.chainId === deployment.network.chainId;

  // Tick once a minute so the unvested countdown moves between RPC refreshes.
  const [nowSec, setNowSec] = useState(() => Math.floor(env.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNowSec(Math.floor(env.now() / 1000)), 30_000);
    return () => window.clearInterval(t);
  }, [env]);

  const vault = data.vault;
  const liveUnvested = vault ? unvestedAt(vault.lockedAmount, vault.lockEnd, vault.unlockDuration, BigInt(Math.max(nowSec, Number(vault.blockTimestamp)))) : undefined;
  const lockRemaining = vault ? Number(vault.lockEnd) - nowSec : 0;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-row">
          <div>
            <p className="eyebrow">Piggy · Sepolia testnet</p>
            <h1>Piggy Vault</h1>
          </div>
          {deployment ? <WalletControl wallet={wallet} networkName={deployment.network.name} expectedChainId={deployment.network.chainId} /> : null}
        </div>
      </header>

      <main id="main" className="container">
        {loadError ? (
          <section className="card" role="alert">
            <h2>Unable to load the deployment configuration</h2>
            <p>{loadError}</p>
            <p className="muted">
              The page reads <code>imd-deployment.json</code> next to <code>index.html</code>. Check the export and reload.
            </p>
          </section>
        ) : null}
        {!deployment && !loadError ? (
          <p className="muted" role="status">
            Loading deployment configuration…
          </p>
        ) : null}

        {deployment && publicClient ? (
          <>
            <section className="intro">
              <p>
                An ERC-4626 vault over PIGY. Deposit PIGY for vPIGY shares, redeem shares for PIGY, or donate PIGY that unlocks to all shareholders
                over seven days. Reads come straight from the contract on {deployment.network.name}; nothing is stored off-chain.
              </p>
            </section>

            <section className="card" aria-labelledby="vault-heading">
              <div className="section-head">
                <h2 id="vault-heading">Vault</h2>
                <p className="muted small">
                  Vault <AddressLink href={deployment.explorerUrl('address', deployment.vault.address)} value={deployment.vault.address} />
                  {vault ? (
                    <>
                      {' · '}
                      {vault.assetSymbol} <AddressLink href={deployment.explorerUrl('address', vault.asset)} value={vault.asset} />
                    </>
                  ) : null}
                  {vault ? <> · block {vault.blockNumber.toString()}</> : null}
                </p>
              </div>
              {data.vaultError ? (
                <p className="inline-error" role="alert">
                  Unable to read the vault from the public RPC. {data.vaultError} Retrying automatically.
                </p>
              ) : null}
              {vault ? (
                <dl className="stats">
                  <Stat label="Share price" value={formatAmount(vault.sharePrice, vault.assetDecimals, 6)} exact={formatExact(vault.sharePrice, vault.assetDecimals)} unit={`${vault.assetSymbol} per ${vault.shareSymbol}`} />
                  <Stat label="Vested assets" value={formatAmount(vault.totalAssets, vault.assetDecimals)} exact={formatExact(vault.totalAssets, vault.assetDecimals)} unit={vault.assetSymbol} />
                  <Stat label="Total shares" value={formatAmount(vault.totalSupply, vault.shareDecimals)} exact={formatExact(vault.totalSupply, vault.shareDecimals)} unit={vault.shareSymbol} />
                  <Stat
                    label="Unvested donations"
                    value={formatAmount(liveUnvested, vault.assetDecimals)}
                    exact={formatExact(liveUnvested, vault.assetDecimals)}
                    unit={vault.assetSymbol}
                    hint={liveUnvested && liveUnvested > 0n ? 'unlocking linearly' : 'nothing streaming'}
                  />
                  <Stat
                    label="Lock end"
                    value={vault.lockEnd === 0n ? 'No donation yet' : formatTimestamp(vault.lockEnd)}
                    hint={vault.lockEnd === 0n ? undefined : lockRemaining > 0 ? `${formatDuration(lockRemaining)} remaining` : 'stream complete'}
                  />
                  <Stat label="Vault balance" value={formatAmount(vault.vaultTokenBalance, vault.assetDecimals)} exact={formatExact(vault.vaultTokenBalance, vault.assetDecimals)} unit={vault.assetSymbol} hint="vested + unvested" />
                </dl>
              ) : !data.vaultError ? (
                <p className="muted" role="status">
                  Reading vault state…
                </p>
              ) : null}
            </section>

            <section className="card" aria-labelledby="position-heading">
              <h2 id="position-heading">Your position</h2>
              {!wallet.account ? (
                <p className="muted">Connect a wallet to see your PIGY balance, allowance and vPIGY shares.</p>
              ) : !onCorrectChain ? (
                <p className="muted">Switch the wallet to {deployment.network.name} to load your position on this network.</p>
              ) : data.positionError ? (
                <p className="inline-error" role="alert">
                  Unable to read the wallet position. {data.positionError}
                </p>
              ) : data.position && vault ? (
                <dl className="stats">
                  <Stat label={`${vault.assetSymbol} balance`} value={formatAmount(data.position.tokenBalance, vault.assetDecimals)} exact={formatExact(data.position.tokenBalance, vault.assetDecimals)} unit={vault.assetSymbol} />
                  <Stat label="Approved for the vault" value={formatAmount(data.position.allowance, vault.assetDecimals)} exact={formatExact(data.position.allowance, vault.assetDecimals)} unit={vault.assetSymbol} />
                  <Stat label="Your shares" value={formatAmount(data.position.shares, vault.shareDecimals)} exact={formatExact(data.position.shares, vault.shareDecimals)} unit={vault.shareSymbol} />
                  <Stat label="Share value" value={formatAmount(data.position.shareValue, vault.assetDecimals)} exact={formatExact(data.position.shareValue, vault.assetDecimals)} unit={vault.assetSymbol} hint="redeemable now" />
                </dl>
              ) : (
                <p className="muted" role="status">
                  Reading wallet position…
                </p>
              )}
            </section>

            {vault ? (
              <section aria-labelledby="actions-heading" className="actions-section">
                <h2 id="actions-heading">Actions</h2>
                <p className="muted">
                  Deposits and donations pull {vault.assetSymbol} from your wallet, so each needs an approval to the vault first. Every transaction is
                  simulated before your wallet opens.
                </p>
                <div className="action-grid">
                  {(['deposit', 'redeem', 'donate'] as const).map((kind) => (
                    <ActionForm
                      key={kind}
                      kind={kind}
                      deployment={deployment}
                      publicClient={publicClient}
                      {...(wallet.walletClient ? { walletClient: wallet.walletClient } : {})}
                      {...(wallet.account ? { account: wallet.account } : {})}
                      onCorrectChain={onCorrectChain}
                      vault={vault}
                      {...(data.position ? { position: data.position } : {})}
                      receiptPollMs={env.receiptPollMs}
                      onConfirmed={data.refresh}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="card" aria-label="Share price history">
              <PriceChart
                points={data.snapshots}
                {...(vault ? { live: { price: vault.sharePrice, timestamp: vault.blockTimestamp } } : {})}
                assetSymbol={vault?.assetSymbol ?? 'PIGY'}
                assetDecimals={vault?.assetDecimals ?? 18}
                shareSymbol={vault?.shareSymbol ?? 'vPIGY'}
                shareDecimals={vault?.shareDecimals ?? 24}
                txUrl={(h) => deployment.explorerUrl('tx', h)}
                loading={data.snapshotsLoading}
                {...(data.snapshotsError ? { error: data.snapshotsError } : {})}
                {...(data.snapshotProgress ? { progress: data.snapshotProgress } : {})}
              />
            </section>

            {vault ? <GetPigy deployment={deployment} assetSymbol={vault.assetSymbol} assetAddress={vault.asset} /> : null}

            <section className="card" aria-labelledby="notes-heading">
              <h2 id="notes-heading">How the vault behaves</h2>
              <ul className="notes">
                <li>Donations vest linearly over seven days. A new donation merges the unvested remainder and restarts the seven-day clock.</li>
                <li>PIGY sent to the vault by a plain transfer counts immediately and is not streamed. Use Donate for a streamed gift.</li>
                <li>If every share is redeemed while donations are still vesting, the remainder accrues to the next depositors.</li>
                <li>Rounding follows ERC-4626 and always favours the vault. A deposit too small to mint a share reverts.</li>
                <li>Withdrawals pay the connected wallet only. There is no owner, fee, pause or upgrade path.</li>
              </ul>
            </section>
          </>
        ) : null}
      </main>

      <footer className="site-footer">
        <div className="container">
          {deployment ? (
            <p className="muted small">
              Chain {deployment.network.chainId} ({deployment.network.name}) · source commit{' '}
              <span className="mono" translate="no" title={deployment.manifest.sourceCommit}>
                {deployment.manifest.sourceCommit.slice(0, 12)}
              </span>{' '}
              · launch <span className="mono" translate="no">{deployment.manifest.launchId}</span> · configuration from <code>imd-deployment.json</code>
            </p>
          ) : null}
          <p className="muted small">Static page; wallet signing stays in your wallet. Public RPC reads only.</p>
        </div>
      </footer>
    </>
  );
}
