import { shortAddress, shortHash } from '../format';

interface Props {
  href: string;
  value: string;
  kind?: 'address' | 'tx';
  /** Visible text; defaults to the shortened value. */
  label?: string;
}

/** Explorer link that keeps the full value reachable through the title attribute. */
export function AddressLink({ href, value, kind = 'address', label }: Props) {
  const text = label ?? (kind === 'tx' ? shortHash(value) : shortAddress(value));
  return (
    <a className="mono link" href={href} target="_blank" rel="noopener noreferrer" title={value} translate="no">
      {text}
      <span className="sr-only"> (opens the block explorer in a new tab)</span>
    </a>
  );
}
