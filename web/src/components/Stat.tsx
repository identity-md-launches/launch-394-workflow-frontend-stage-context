import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  /** Exact value shown in the title attribute so rounding never hides information. */
  exact?: string;
  unit?: string;
  hint?: ReactNode;
}

export function Stat({ label, value, exact, unit, hint }: Props) {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">
        <span className="num" title={exact}>
          {value}
        </span>
        {unit ? <span className="stat-unit"> {unit}</span> : null}
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </dd>
    </div>
  );
}
