// Streaks & Badges — the sealed streak chain, mintBadge, and the demo
// showpiece: proveBadge to a mock employer panel (third-party verification
// while the streak data stays sealed).

import { useState } from 'react';
import { useDemo } from '../state/DemoStore';
import { Button, Card, Chip, Modal, Notice } from '../components/bits';
import { EMPLOYER } from '../domain/story';
import { logError } from '../lib/logger';

export const StreaksScreen = () => {
  const { streak, badges, session, advanceStreak, mintBadge, proveBadge } = useDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employerOpen, setEmployerOpen] = useState(false);
  const [provingBadge, setProvingBadge] = useState<number | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      logError('StreaksScreen.action', err);
      setError(err instanceof Error ? err.message : 'action failed');
    } finally {
      setBusy(null);
    }
  };

  const streakBadge = badges.find((b) => b.id === 1);
  const distanceBadge = badges.find((b) => b.id === 2);
  const streakReady = (streak?.current ?? 0) >= 3;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Streaks &amp; Badges — sealed proof of habit</h1>
        <p className="screen-sub">
          Every chain link is a sealed day. Badges mint from the chain;{' '}
          <code className="mono">proveBadge</code> lets a third party verify the feat without ever
          seeing the workouts behind it.
        </p>
      </div>

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <div className="grid-2">
        <Card title="Sealed streak chain" glow>
          {!session ? (
            <div className="empty-state">Enter the demo on the Connect tab first.</div>
          ) : (
            <>
              <div className="row-between">
                <div>
                  <div className="stat" style={{ fontSize: 30, fontWeight: 800 }}>
                    {streak?.current ?? 0}
                    <span className="faint" style={{ fontSize: 16, fontWeight: 500 }}>
                      {' '}
                      day streak
                    </span>
                  </div>
                </div>
                <Button
                  tone="seal"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run('advance', () => advanceStreak())}
                >
                  {busy === 'advance' ? <span className="spin" /> : null}
                  Attest today → advance
                </Button>
              </div>

              <div className="streak-days">
                {streak?.days.map((day) => (
                  <div
                    key={day.day}
                    className={[
                      'streak-day',
                      day.sealed ? 'streak-day--sealed' : '',
                      day.active ? 'streak-day--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {day.sealed ? <span className="streak-day__flame">🔥</span> : <span className="wax" style={{ width: 16, height: 16 }} />}
                    {day.label}
                  </div>
                ))}
                {streak?.days.some((d) => d.label === 'TODAY' && d.sealed) ? null : (
                  <div className="streak-day streak-day--active">TODAY</div>
                )}
              </div>

              <div className="hash">chain commitment: {streak?.chainId}</div>

              <div style={{ marginTop: 12 }}>
                <Notice tone="info">
                  Each link is sealed with the day's attested credential. The chain proves{' '}
                  <em>continuity</em> — the workouts behind it never leave your machine.
                </Notice>
              </div>
            </>
          )}
        </Card>

        <Card title="Badges">
          {!session ? (
            <div className="empty-state">Badges mint from your attested chain.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <BadgeRow
                badgeId={1}
                label={streakBadge?.label ?? 'Streak of 3'}
                requirement={streakBadge?.requirement ?? ''}
                minted={streakBadge?.minted ?? false}
                count={streakBadge?.count}
                busy={busy}
                onMint={() => void run('mint1', () => mintBadge(1))}
                onProve={() => {
                  setProvingBadge(1);
                  setEmployerOpen(true);
                }}
                proving={provingBadge === 1}
                disabled={!streakReady && !(streakBadge?.minted ?? false)}
                disabledReason={streakReady ? undefined : 'requires a 3-day attested streak'}
              />
              <div className="divider" />
              <BadgeRow
                badgeId={2}
                label={distanceBadge?.label ?? 'Centurion'}
                requirement={distanceBadge?.requirement ?? ''}
                minted={distanceBadge?.minted ?? false}
                busy={busy}
                onMint={() => void run('mint2', () => mintBadge(2))}
                onProve={() => {
                  setProvingBadge(2);
                  setEmployerOpen(true);
                }}
                proving={provingBadge === 2}
                disabled={false}
                disabledReason="requires an attested distance ≥ 10 km"
              />
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Notice tone="info">
          <strong>The showpiece:</strong> hand {EMPLOYER.name} a verification, not your data. The
          mock-employer panel is the next tab.
        </Notice>
      </div>

      <EmployerModal
        open={employerOpen}
        onClose={() => {
          setEmployerOpen(false);
          setProvingBadge(null);
        }}
        badgeId={provingBadge}
        onProve={async (verifier) => {
          if (provingBadge === null) return;
          setProvingBadge(provingBadge);
          await proveBadge(provingBadge, verifier);
        }}
      />
    </div>
  );
};

const BadgeRow = ({
  badgeId,
  label,
  requirement,
  minted,
  count,
  busy,
  onMint,
  onProve,
  proving,
  disabled,
  disabledReason,
}: {
  badgeId: number;
  label: string;
  requirement: string;
  minted: boolean;
  count?: number;
  busy: string | null;
  onMint: () => void;
  onProve: () => void;
  proving: boolean;
  disabled: boolean;
  disabledReason?: string;
}) => (
  <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
    <div className={`medal ${minted ? '' : 'medal--dim'}`}>{badgeId === 1 ? '🔥' : '🏅'}</div>
    <div style={{ flex: 1 }}>
      <div className="row-between">
        <div>
          <div style={{ fontWeight: 700 }}>{label}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {requirement}
            {count ? ` · held: ${count} days` : ''}
          </div>
        </div>
        {minted ? <Chip tone="provable">minted</Chip> : <Chip>not yet</Chip>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button tone="gold" size="sm" disabled={busy !== null || disabled} onClick={onMint} title={disabledReason}>
          {busy === `mint${badgeId}` ? <span className="spin" /> : null}
          mintBadge({badgeId})
        </Button>
        <Button tone="ghost" size="sm" disabled={!minted || busy !== null} onClick={onProve}>
          {proving ? <span className="spin" /> : null}
          proveBadge →
        </Button>
      </div>
    </div>
  </div>
);

const EmployerModal = ({
  open,
  onClose,
  badgeId,
  onProve,
}: {
  open: boolean;
  onClose: () => void;
  badgeId: number | null;
  onProve: (verifier: string) => Promise<void>;
}) => {
  const { proofs } = useDemo();
  const [verifier, setVerifier] = useState(EMPLOYER.handle + '@northwind.example');
  const [running, setRunning] = useState(false);

  const submit = async () => {
    if (badgeId === null) return;
    setRunning(true);
    try {
      await onProve(verifier);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="card-title">Mock employer — third-party verification</h3>
      <div className="employer-frame">
        <div className="employer-bar">
          <div className="wax" style={{ width: 18, height: 18 }} />
          <strong>{EMPLOYER.name}</strong>
          <span className="faint">wellness program · verifier panel</span>
        </div>
        <div className="verify-line verify-line--pending">
          <span>01</span> employee submits a badge proof request
        </div>
        <div className="verify-line verify-line--pending">
          <span>02</span> contract runs <code>proveBadge</code> — returns the verifier binding
        </div>
        <div className="verify-line verify-line--sealed">
          <span>03</span> streak data remains sealed (ledger stores commitments only)
        </div>
        {proofs.filter((p) => p.badgeId === badgeId).map((proof) => (
          <div key={proof.proofId} className="verify-line verify-line--ok">
            <span>✓</span> {proof.statement} · proof {proof.proofId.slice(0, 20)}…
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="field">
          <label>Verifier identity (binding)</label>
          <input className="input" value={verifier} onChange={(e) => setVerifier(e.target.value)} />
        </div>
        <div className="row-between">
          <Button tone="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={running || badgeId === null || !verifier.trim()}
          >
            {running ? <span className="spin" /> : null}
            Prove badge to verifier
          </Button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Notice tone="info">
          The proof receipt names the badge and the verifier — the workouts, dates, and distances
          behind it never leave the sealed chain.
        </Notice>
      </div>
    </Modal>
  );
};

export { EmployerModal };
