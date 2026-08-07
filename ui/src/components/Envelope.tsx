// The sealed-envelope glyph: provably unreadable submissions. Hover shows the
// on-chain commitment, never a value.

interface EnvelopeProps {
  label: string;
  sealed: boolean;
  landing?: boolean;
  commitment?: string;
  value?: string;
  valueMasked?: boolean;
  title?: string;
}

export const Envelope = ({
  label,
  sealed,
  landing,
  commitment,
  value,
  valueMasked,
  title,
}: EnvelopeProps) => {
  const stateClass = sealed ? '' : 'envelope--open';
  const landClass = landing ? 'envelope--landing' : '';
  return (
    <div
      className={`envelope ${stateClass} ${landClass}`}
      title={title ?? (commitment ? `commitment on-chain: ${commitment}` : 'sealed — no value readable')}
    >
      <div className="wax" />
      <div className="envelope-label">{label}</div>
      {sealed ? (
        <div className="envelope-value envelope-value--sealed">••••</div>
      ) : valueMasked ? (
        <div className="envelope-value envelope-value--masked">••••</div>
      ) : (
        <div className="envelope-value">{value}</div>
      )}
      <div className="envelope-tip">{commitment ? `${commitment.slice(0, 12)}…` : 'sealed'}</div>
    </div>
  );
};
