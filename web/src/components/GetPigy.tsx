import type { Deployment } from '../deployment';
import { AddressLink } from './AddressLink';

interface Props {
  deployment: Deployment;
  assetSymbol: string;
  assetAddress: string;
}

/**
 * PIGY is obtained by swapping Sepolia ETH in the launch pool. The approved workflow
 * asks for an explanation and no in-page swap, so this section points at the pool
 * addresses from the vetted network block and the token contract.
 */
export function GetPigy({ deployment, assetSymbol, assetAddress }: Props) {
  const { network } = deployment;
  const v4 = network.uniswapV4;
  return (
    <section className="card" aria-labelledby="get-pigy">
      <h2 id="get-pigy">Getting {assetSymbol}</h2>
      <p>
        {assetSymbol} comes from swapping {network.name} {network.nativeCurrency.symbol} in the launch pool, a Uniswap v4 pool paired with native{' '}
        {network.nativeCurrency.symbol} (0.3% fee, tick spacing 60, no hook). This page does not swap; use a Uniswap v4 interface or a wallet swap
        that supports {network.name}, then return here to deposit or donate.
      </p>
      <dl className="kv">
        <div>
          <dt>{assetSymbol} token</dt>
          <dd>
            <AddressLink href={deployment.explorerUrl('address', assetAddress)} value={assetAddress} />
          </dd>
        </div>
        <div>
          <dt>Pool manager</dt>
          <dd>
            <AddressLink href={deployment.explorerUrl('address', v4.poolManager)} value={v4.poolManager} />
          </dd>
        </div>
        <div>
          <dt>Universal router</dt>
          <dd>
            <AddressLink href={deployment.explorerUrl('address', v4.universalRouter)} value={v4.universalRouter} />
          </dd>
        </div>
        <div>
          <dt>Quoter</dt>
          <dd>
            <AddressLink href={deployment.explorerUrl('address', v4.quoter)} value={v4.quoter} />
          </dd>
        </div>
      </dl>
      {network.testnet && network.faucets.length > 0 ? (
        <p className="muted small">
          Need {network.nativeCurrency.symbol} for gas and swaps? Test {network.nativeCurrency.symbol} faucets:{' '}
          {network.faucets.map((f, i) => (
            <span key={f}>
              {i > 0 ? ', ' : ''}
              <a className="link" href={f} target="_blank" rel="noopener noreferrer">
                {new URL(f).hostname}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}
