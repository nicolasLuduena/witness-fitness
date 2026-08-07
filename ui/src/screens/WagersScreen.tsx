// Wagers — create/join/open wagers with sealed envelope submissions, and the
// settle reveal (winner + pot; "find the losing number"; athletes choose to
// disclose). The ledger never publishes the losing input.
//
// Fixture mode: the rehearsed story (Ava 3.90 km vs Milo 2.43 km, auto
// opponent submission). Live mode: REAL on-chain wagers via the sidecar —
// both athletes are sidecar identities (A/B), stakes move unshielded NIGHT,
// the winner receives a shielded WitnessFitness NFT, and the disclosed
// comparison appears only when the athletes choose to show it.

import { useEffect, useState } from 'react';
import { useDemo } from '../state/DemoStore';
import { Button, Card, Chip, Modal, Notice } from '../components/bits';
import { Envelope } from '../components/Envelope';
import { RevealSettle } from '../components/RevealSettle';
import { ATHLETE_A, ATHLETE_B } from '../domain/story';
import { METRICS } from '../domain/types';
import type { Athlete, WagerCreateRequest, WagerView } from '../domain/types';
import { fmtTnight, hexShort } from '../lib/format';
import { challengeIdOf, formatCountdown, settleReadyAtMs } from '../lib/wager-countdown';

const statusLabel: Record<WagerView['status'], string> = {
  open: 'open — waiting for opponent',
  accepted: 'accepted — awaiting submissions',
  submitted: 'submissions sealed',
  settled: 'settled',
  cancelled: 'cancelled',
};

export const WagersScreen = () => {
  const {
    mode,
    wagers,
    credentials,
    session,
    acceptWager,
    submitWorkout,
    settleWager,
    createWager,
    settleReveal,
    clearSettleReveal,
    refresh,
  } = useDemo();

  const [createOpen, setCreateOpen] = useState(false);
  const [submitFor, setSubmitFor] = useState<WagerView | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);

  const isLive = mode === 'live';

  // Poll while a wager is awaiting the opponent's sealed submission.
  useEffect(() => {
    const awaiting = wagers.some((w) => w.status === 'submitted');
    if (!awaiting) return;
    const timer = window.setInterval(() => void refresh(), 1_400);
    return () => window.clearInterval(timer);
  }, [wagers, refresh]);

  // 1 s tick while any live wager is accepted/submitted but not settled —
  // drives the settle countdown.
  useEffect(() => {
    const needsTick = isLive && wagers.some((w) => w.status !== 'settled' && w.status !== 'open');
    if (!needsTick) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isLive, wagers]);

  const run = async (id: number | null, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'action failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (req: WagerCreateRequest) => {
    await createWager(req);
    setCreateOpen(false);
  };

  const matchingCredentials = (wager: WagerView) =>
    credentials.filter((c) => c.metric.id === wager.metric.id && c.value > 0);

  const copyChallengeId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setActionError('clipboard unavailable');
    }
  };

  const submittedBy = (wager: WagerView, athlete: Athlete) =>
    wager.submissions.some((s) => s.athlete.handle === athlete.handle);

  const settleLocked = (wager: WagerView): { locked: boolean; label: string } => {
    if (wager.deadlineBlock <= 0n) return { locked: false, label: '' };
    const readyAt = settleReadyAtMs(wager.deadlineBlock);
    const left = readyAt - now;
    if (left <= 0) return { locked: false, label: 'settle unlocked' };
    return { locked: true, label: `settle in ${formatCountdown(left)}` };
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div className="row-between">
          <div>
            <h1 className="screen-title">Wagers — sealed duels</h1>
            <p className="screen-sub">
              Two athletes stake; the chain compares two <strong>sealed distances</strong> at the
              deadline and pays the winner. The room never sees a single number.
            </p>
          </div>
          {session ? (
            <Button tone="seal" onClick={() => setCreateOpen(true)}>
              + Create wager
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="error">{actionError}</Notice>
        </div>
      ) : null}

      {isLive && session ? (
        <div style={{ marginBottom: 16 }}>
          <Card title="Roster — challenge IDs">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {[
                { id: 'A', athlete: ATHLETE_A, note: 'seed ONE' },
                { id: 'B', athlete: ATHLETE_B, note: 'seed TWO' },
              ].map((entry) => (
                <div key={entry.id} className="chip chip--gold" style={{ padding: '6px 12px', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{entry.athlete.name}</span>
                  <span className="faint">challenge ID</span>
                  <span className="mono" style={{ cursor: 'pointer' }} title="copy challenge ID" onClick={() => void copyChallengeId(entry.id)}>
                    {entry.id} {copied === entry.id ? '✓' : '⧉'}
                  </span>
                  <span className="faint">{entry.note}</span>
                </div>
              ))}
              <span className="faint" style={{ fontSize: 12 }}>
                paste a challenge ID into the create form to challenge by ID — real NIGHT moves
                on-chain; the winner also receives a shielded WitnessFitness NFT.
              </span>
            </div>
          </Card>
        </div>
      ) : null}

      {settleReveal ? (
        <div style={{ marginBottom: 20 }}>
          <RevealSettle result={settleReveal} />
          <div className="row" style={{ marginTop: 12 }}>
            <Button tone="ghost" size="sm" onClick={clearSettleReveal}>
              Close reveal
            </Button>
          </div>
        </div>
      ) : null}

      {wagers.length === 0 ? (
        <div className="empty-state">
          No wagers yet. {session ? 'Create one — or use the seeded "Evening walk" wager in demo mode.' : 'Enter the demo on the Connect tab first.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {wagers.map((wager) => {
            const canSubmit = wager.status === 'accepted' && wager.submissions.length === 0;
            const readyToSettle = wager.status === 'submitted' && wager.submissions.length === 2;
            const localCreds = matchingCredentials(wager);
            const lock = settleLocked(wager);
            return (
              <Card key={wager.id} title={`Wager #${wager.id} — ${wager.title}`} glow={wager.status !== 'settled'}>
                <div className="row-between" style={{ marginBottom: 14 }}>
                  <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                    <Chip>{wager.metric.label}</Chip>
                    <Chip tone="gold">
                      {fmtTnight(wager.stake)} {wager.result?.currency ?? (isLive ? 'NIGHT' : 'tNIGHT')} stake
                    </Chip>
                    <Chip>
                      {isLive
                        ? `settle unlocks ${formatCountdown(settleReadyAtMs(wager.deadlineBlock) - now)}`
                        : `deadline block ${wager.deadlineBlock.toString()}`}
                    </Chip>
                  </div>
                  <Chip tone={wager.status === 'settled' ? 'provable' : wager.status === 'submitted' ? 'seal' : 'default'}>
                    {statusLabel[wager.status]}
                  </Chip>
                </div>

                <div className="row" style={{ gap: 22, justifyContent: 'center', margin: '18px 0' }}>
                  <Envelope
                    label={wager.challenger.name}
                    sealed={!wager.submissions.some((s) => s.athlete.handle === wager.challenger.handle)}
                    commitment={wager.submissions.find((s) => s.athlete.handle === wager.challenger.handle)?.commitment}
                    title="sealed submission — commitment on-chain, value never published"
                  />
                  <span className="faint mono">vs</span>
                  <Envelope
                    label={wager.opponent.name}
                    sealed={!wager.submissions.some((s) => s.athlete.handle === wager.opponent.handle)}
                    commitment={wager.submissions.find((s) => s.athlete.handle === wager.opponent.handle)?.commitment}
                    title="sealed submission — commitment on-chain, value never published"
                  />
                </div>

                {wager.status === 'open' ? (
                  <Button
                    tone="primary"
                    block
                    disabled={busyId !== null}
                    onClick={() => void run(wager.id, () => acceptWager(wager.id))}
                  >
                    {busyId === wager.id ? <span className="spin" /> : null}
                    Accept as {wager.opponent.name}
                  </Button>
                ) : null}

                {isLive && wager.status === 'accepted' ? (
                  <div className="row" style={{ gap: 10 }}>
                    <Button
                      tone="seal"
                      block
                      disabled={busyId !== null || submittedBy(wager, wager.challenger)}
                      onClick={() => void run(wager.id, () => submitWorkout(wager.id, athleteOf(wager.challenger)))}
                    >
                      {busyId === wager.id ? <span className="spin" /> : null}
                      {submittedBy(wager, wager.challenger) ? 'Sealed ✓' : `Seal ${wager.challenger.name}'s submission`}
                    </Button>
                    <Button
                      tone="seal"
                      block
                      disabled={busyId !== null || submittedBy(wager, wager.opponent)}
                      onClick={() => void run(wager.id, () => submitWorkout(wager.id, athleteOf(wager.opponent)))}
                    >
                      {busyId === wager.id ? <span className="spin" /> : null}
                      {submittedBy(wager, wager.opponent) ? 'Sealed ✓' : `Seal ${wager.opponent.name}'s submission`}
                    </Button>
                  </div>
                ) : null}

                {!isLive && canSubmit ? (
                  <Button tone="seal" block disabled={busyId !== null || localCreds.length === 0} onClick={() => setSubmitFor(wager)}>
                    Submit sealed workout{localCreds.length === 0 ? ' (attest first)' : ` — ${localCreds.length} credential${localCreds.length > 1 ? 's' : ''} available`}
                  </Button>
                ) : null}

                {wager.status === 'submitted' && wager.submissions.length === 1 ? (
                  <Notice tone="info">Waiting for the other athlete's sealed submission…</Notice>
                ) : null}

                {readyToSettle ? (
                  <Button
                    tone="gold"
                    block
                    disabled={busyId !== null || (isLive && lock.locked)}
                    onClick={() => void run(wager.id, () => settleWager(wager.id))}
                  >
                    {busyId === wager.id ? <span className="spin" /> : null}
                    Settle — reveal winner under seal{isLive && lock.locked ? ` (${lock.label})` : ''}
                  </Button>
                ) : null}

                {wager.status === 'settled' && wager.result ? (
                  <Notice tone={wager.result.tie || wager.result.forfeit ? 'info' : 'success'}>
                    {wager.result.summary} · pot {fmtTnight(wager.result.pot)} {wager.result.currency} ·{' '}
                    {wager.result.disclosed
                      ? 'athletes disclosed the comparison at settlement'
                      : 'comparison not disclosed'}
                    {wager.result.nft ? ' · shielded NFT to the winner' : ''}
                  </Notice>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {session ? (
        <div style={{ marginTop: 18 }}>
          <Notice tone="info">
            Sealed submission commitments land on-chain as <code className="mono">transientCommit</code>{' '}
            envelopes — hover them: <code className="mono">{hexShort('0x' + '0'.repeat(64), 10, 8)}</code> style.
            Only the athletes' openings can ever open them, and the losing opening is never published.
          </Notice>
        </div>
      ) : null}

      <CreateWagerModal
        open={createOpen}
        live={isLive}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {submitFor ? (
        <SubmitModal
          wager={submitFor}
          onClose={() => setSubmitFor(null)}
          onSubmit={async (credentialId) => {
            await run(submitFor.id, () => submitWorkout(submitFor.id, credentialId));
            setSubmitFor(null);
          }}
        />
      ) : null}
    </div>
  );
};

const athleteOf = (athlete: Athlete): 'A' | 'B' => (athlete.handle === ATHLETE_B.handle ? 'B' : 'A');

const CreateWagerModal = ({
  open,
  live,
  onClose,
  onCreate,
}: {
  open: boolean;
  live: boolean;
  onClose: () => void;
  onCreate: (req: WagerCreateRequest) => Promise<void>;
}) => {
  const [metricId, setMetricId] = useState<string>('1');
  const [stake, setStake] = useState(live ? '10' : '50');
  const [deadline, setDeadline] = useState(live ? '90' : '12');
  const [challengeId, setChallengeId] = useState<string>('');
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const opponentOf = (): Athlete => {
    if (live) {
      const parsed = challengeIdOf(challengeId);
      if (parsed === 'B') return ATHLETE_B;
      if (parsed === 'A') return ATHLETE_A;
    }
    return ATHLETE_B;
  };

  const submit = async () => {
    if (live && challengeIdOf(challengeId) === null) {
      setChallengeError('unknown challenge ID — the roster IDs are A (Ava) and B (Milo)');
      return;
    }
    setChallengeError(null);
    setSaving(true);
    try {
      await onCreate({
        opponent: opponentOf(),
        metricId: BigInt(metricId),
        stake: Number(stake),
        deadlineBlock: live
          ? BigInt(Math.floor(Date.now() / 1000) + Number(deadline))
          : BigInt(1_500_000 + Number(deadline) * 10),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="card-title">Create wager</h3>
      {live ? (
        <div className="field">
          <label>Opponent — challenge by ID (A = Ava, B = Milo)</label>
          <input
            className="input"
            placeholder="Challenge ID, e.g. B"
            value={challengeId}
            onChange={(e) => setChallengeId(e.target.value)}
          />
          {challengeError ? (
            <div style={{ marginTop: 6 }}>
              <Notice tone="error">{challengeError}</Notice>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="field">
        <label>Metric</label>
        <select className="select" value={metricId} onChange={(e) => setMetricId(e.target.value)}>
          {METRICS.map((m) => (
            <option key={m.id.toString()} value={m.id.toString()}>
              {m.label} ({m.unit})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Stake ({live ? 'NIGHT' : 'tNIGHT'})</label>
        <input className="input" type="number" min={1} value={stake} onChange={(e) => setStake(e.target.value)} />
      </div>
      <div className="field">
        <label>{live ? 'Deadline (seconds from now)' : 'Deadline (blocks from now)'}</label>
        <input className="input" type="number" min={1} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div className="row-between">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="seal" onClick={() => void submit()} disabled={saving}>
          {saving ? <span className="spin" /> : null} Create & escrow stake
        </Button>
      </div>
      <div style={{ marginTop: 12 }}>
        <Notice tone="info">
          {live
            ? `Challenging ${opponentOf().name} (${athleteOf(opponentOf())}). The ${stake} NIGHT stake is escrowed on-chain for real; the winner takes both sides plus a shielded NFT.`
            : `Challenging ${ATHLETE_B.name}. The stake is escrowed in the contract.`}
        </Notice>
      </div>
    </Modal>
  );
};

const SubmitModal = ({
  wager,
  onClose,
  onSubmit,
}: {
  wager: WagerView;
  onClose: () => void;
  onSubmit: (credentialId: string) => Promise<void>;
}) => {
  const { credentials } = useDemo();
  const matching = credentials.filter((c) => c.metric.id === wager.metric.id && c.value > 0);
  const [selected, setSelected] = useState<string>(matching[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await onSubmit(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <h3 className="card-title">Submit sealed workout — {wager.title}</h3>
      {matching.length === 0 ? (
        <Notice tone="warn">No matching {wager.metric.label} credential in your vault. Attest one first.</Notice>
      ) : (
        <>
          <div className="field">
            <label>Choose a vaulted credential</label>
            <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {matching.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provableChips[0]} — sealed {c.id.slice(0, 14)}…
                </option>
              ))}
            </select>
          </div>
          <div className="row-between">
            <Button tone="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button tone="seal" onClick={() => void submit()} disabled={saving || !selected}>
              {saving ? <span className="spin" /> : null} Seal submission
            </Button>
          </div>
          <div style={{ marginTop: 12 }}>
            <Notice tone="info">
              Your value is committed under a fresh opening — the envelope the chain sees is{' '}
              <code className="mono">transientCommit(value, rand)</code>, nothing else.
            </Notice>
          </div>
        </>
      )}
    </Modal>
  );
};
