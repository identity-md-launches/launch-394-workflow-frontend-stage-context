import type { TxStatus } from '../hooks/useTransaction';
import { AddressLink } from './AddressLink';

interface Props {
  status: TxStatus;
  txUrl: (hash: string) => string;
  onDismiss: () => void;
}

const phaseText: Record<TxStatus['phase'], string> = {
  idle: '',
  simulating: 'Checking the transaction…',
  signing: 'Confirm in your wallet.',
  pending: 'Sent. Waiting for confirmation…',
  confirmed: 'Confirmed.',
  cancelled: '',
  failed: 'Failed.',
};

/** One stable live region per form: rendered from the start, text swapped as the phase changes. */
export function TxStatusLine({ status, txUrl, onDismiss }: Props) {
  const busy = status.phase === 'simulating' || status.phase === 'signing' || status.phase === 'pending';
  const tone = status.phase === 'failed' ? 'status-error' : status.phase === 'confirmed' ? 'status-ok' : 'status-info';
  return (
    <div className={`tx-status ${status.phase === 'idle' ? 'tx-status-empty' : tone}`} role={status.phase === 'failed' ? 'alert' : 'status'}>
      {status.phase !== 'idle' ? (
        <>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          <span>
            {status.label ? <strong>{status.label}: </strong> : null}
            {phaseText[status.phase]}
            {status.error ? ` ${status.error}` : ''}
            {status.hash ? (
              <>
                {' '}
                <AddressLink href={txUrl(status.hash)} value={status.hash} kind="tx" label="View transaction" />
              </>
            ) : null}
          </span>
          {!busy ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
