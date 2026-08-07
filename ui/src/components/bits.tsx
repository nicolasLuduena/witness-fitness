// Small UI primitives shared across screens.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type Tone = 'default' | 'primary' | 'seal' | 'ghost' | 'gold';

export const Button = ({
  tone = 'default',
  size,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  size?: 'sm';
  block?: boolean;
}) => {
  const classes = [
    'btn',
    tone === 'primary' ? 'btn--primary' : '',
    tone === 'seal' ? 'btn--seal' : '',
    tone === 'ghost' ? 'btn--ghost' : '',
    tone === 'gold' ? 'btn--gold' : '',
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
};

export const Chip = ({ tone = 'default', children }: { tone?: 'default' | 'provable' | 'gold' | 'seal'; children: ReactNode }) => {
  const cls =
    tone === 'provable'
      ? 'chip chip--provable'
      : tone === 'gold'
        ? 'chip chip--gold'
        : tone === 'seal'
          ? 'chip chip--seal'
          : 'chip';
  return <span className={cls}>{children}</span>;
};

export const Dot = ({ tone, pulse }: { tone: 'green' | 'amber' | 'red' | 'off'; pulse?: boolean }) => (
  <span
    className={[
      'dot',
      tone === 'green' ? 'dot--green' : '',
      tone === 'amber' ? 'dot--amber' : '',
      tone === 'red' ? 'dot--red' : '',
      pulse ? 'dot--pulse' : '',
    ]
      .filter(Boolean)
      .join(' ')}
  />
);

export const Card = ({
  title,
  children,
  glow,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  glow?: boolean;
  className?: string;
}) => (
  <div className={`card ${glow ? 'card--glow' : ''} ${className}`}>
    {title ? <h3 className="card-title">{title}</h3> : null}
    {children}
  </div>
);

export const Hash = ({ value }: { value: string }) => <span className="hash">{value}</span>;

export const Notice = ({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) => <div className={`notice notice--${tone}`}>{children}</div>;

export const Modal = ({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) => {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

export const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <div className="stat-label">{label}</div>
    <div className="stat">{value}</div>
  </div>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="card-title">{children}</h3>
);
