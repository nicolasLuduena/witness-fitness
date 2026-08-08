// Wagers — create/join/open wagers with sealed envelope submissions, and the
// settle reveal (winner + pot; "find the losing number"; athletes choose to
// disclose). The ledger never publishes the losing input.
//
// Fixture mode: the rehearsed story (Ava 3.90 km vs Milo 2.43 km, auto
// opponent submission). Live mode: REAL on-chain wagers via the sidecar —
// both athletes are sidecar identities (A/B), stakes move unshielded NIGHT,
// the winner receives a shielded WitnessFitness NFT, and the disclosed
// comparison appears only when the athletes choose to show it.

import { useEffect, useState } from "react";
import { Button, Card, Chip, Modal, Notice } from "../components/bits";
import { Envelope } from "../components/Envelope";
import { RevealSettle } from "../components/RevealSettle";
import { ATHLETE_A, ATHLETE_B } from "../domain/story";
import type { Athlete, WagerCreateRequest, WagerView } from "../domain/types";
import { METRICS } from "../domain/types";
import { fmtTnight, hexShort } from "../lib/format";
import { logError } from "../lib/logger";
import { challengeIdOf, formatCountdown, settleReadyAtMs } from "../lib/wager-countdown";
import { useDemo } from "../state/DemoStore";

const statusLabel: Record<WagerView["status"], string> = {
  open: "open — waiting for opponent",
  accepted: "accepted — awaiting submissions",
  submitted: "submissions sealed",
  settled: "settled",
  cancelled: "cancelled",
};

export const WagersScreen = () => {
  const {
    mode,
    wagers,
    session,
    credentials,
    acceptWager,
    submitWorkout,
    settleWager,
    createWager,
    settleReveal,
    clearSettleReveal,
    refresh,
  } = useDemo();

  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);

  const isLive = mode === "live";
  const isWallet = mode === "wallet";

  // Poll while ANY wager is mid-flight (open/accepted/submitted) — discovery
  // of opponent actions (accept, seal) is indexer-lag-bound; also covers the
  // post-create read-back window (audit P1-5).
  useEffect(() => {
    const awaiting = wagers.some(
      (w) => w.status === "open" || w.status === "accepted" || w.status === "submitted",
    );
    if (!awaiting) return;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [wagers, refresh]);

  // 1 s tick while any wager is accepted/submitted but not settled — drives
  // the settle countdown (both live and wallet modes carry real deadlines).
  useEffect(() => {
    const needsTick = wagers.some((w) => w.status !== "settled" && w.status !== "open");
    if (!needsTick) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [wagers]);

  // Wallet mode: the credential my sealed submission opens (the latest
  // attested workout — real distance, never revealed).
  const myCredentialId = credentials[0]?.id;

  const run = async (id: number | null, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      logError("WagersScreen.action", err);
      setActionError(err instanceof Error ? err.message : "action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (req: WagerCreateRequest) => {
    setActionError(null);
    try {
      await createWager(req);
      setCreateOpen(false);
    } catch (err) {
      logError("WagersScreen.create", err);
      setActionError(err instanceof Error ? err.message : "wager create failed");
    }
  };

  const copyChallengeId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch (err) {
      logError("WagersScreen.copyChallengeId", err);
      setActionError("clipboard unavailable");
    }
  };

  const submittedBy = (wager: WagerView, athlete: Athlete) =>
    wager.submissions.some((s) => s.athlete.handle === athlete.handle);

  const settleLocked = (wager: WagerView): { locked: boolean; label: string } => {
    if (wager.deadlineBlock <= 0n) return { locked: false, label: "" };
    const readyAt = settleReadyAtMs(wager.deadlineBlock);
    const left = readyAt - now;
    if (left <= 0) return { locked: false, label: "settle unlocked" };
    return { locked: true, label: `settle in ${formatCountdown(left)}` };
  };

  // Submissions close at the deadline (the contract enforces it — audit H1);
  // the UI mirrors it so the button state never lies.
  const submitLocked = (wager: WagerView): { locked: boolean; label: string } => {
    if (wager.deadlineBlock <= 0n) return { locked: false, label: "" };
    const left = Number(wager.deadlineBlock) * 1000 - now;
    if (left <= 0) return { locked: true, label: "submissions closed at the deadline" };
    return { locked: false, label: `submissions close in ${formatCountdown(left)}` };
  };

  // The contract settles every outcome once the deadline + grace passes:
  // both submitted → reveal the winner; one → forfeit; none → refund both.
  const settleLabel = (wager: WagerView): string => {
    const challengerSubmitted = wager.submissions.some(
      (s) => s.athlete.handle === wager.challenger.handle,
    );
    const opponentSubmitted = wager.submissions.some(
      (s) => s.athlete.handle === wager.opponent.handle,
    );
    if (challengerSubmitted && opponentSubmitted) return "Settle — reveal winner";
    if (challengerSubmitted) return `Settle — forfeit to ${wager.challenger.name}`;
    if (opponentSubmitted) return `Settle — forfeit to ${wager.opponent.name}`;
    return "Settle — refund both (no submissions)";
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
            <div className="row" style={{ gap: 10 }}>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => void refresh()}
                title="Re-read wagers from the chain"
              >
                ↻ Refresh
              </Button>
              <Button tone="seal" onClick={() => setCreateOpen(true)}>
                + Create wager
              </Button>
            </div>
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
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              {[
                { id: "A", athlete: ATHLETE_A, note: "seed ONE" },
                { id: "B", athlete: ATHLETE_B, note: "seed TWO" },
              ].map((entry) => (
                <div
                  key={entry.id}
                  className="chip chip--gold"
                  style={{ padding: "6px 12px", gap: 8 }}
                >
                  <span style={{ fontWeight: 700 }}>{entry.athlete.name}</span>
                  <span className="faint">challenge ID</span>
                  <button
                    type="button"
                    className="copy-id-btn"
                    title="copy challenge ID"
                    onClick={() => void copyChallengeId(entry.athlete.holderBinding)}
                  >
                    {copied === entry.athlete.holderBinding ? "Copied ✓" : "Copy ID"}
                  </button>
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
          No wagers yet.{" "}
          {session
            ? isWallet
              ? "Challenge another wallet by its holder-binding ID (their Connect tab) — real NIGHT moves on-chain; the winner takes the pot plus a shielded NFT."
              : "Create one — both athletes are sidecar identities (A/B); the winner takes the pot plus a shielded NFT."
            : "Enter the demo on the Connect tab first."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {wagers.map((wager) => {
            const readyToSettle = wager.status === "accepted" || wager.status === "submitted";
            const lock = settleLocked(wager);
            const submitLock = submitLocked(wager);
            return (
              <Card
                key={wager.id}
                title={`Wager #${wager.id} — ${wager.title}`}
                glow={wager.status !== "settled"}
              >
                <div className="row-between" style={{ marginBottom: 14 }}>
                  <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
                    <Chip>{wager.metric.label}</Chip>
                    <Chip tone="gold">
                      {fmtTnight(wager.stake)} {wager.result?.currency ?? "NIGHT"} stake
                    </Chip>
                    <Chip>
                      settle unlocks {formatCountdown(settleReadyAtMs(wager.deadlineBlock) - now)}
                    </Chip>
                  </div>
                  <Chip
                    tone={
                      wager.status === "settled"
                        ? "provable"
                        : wager.status === "submitted"
                          ? "seal"
                          : "default"
                    }
                  >
                    {statusLabel[wager.status]}
                  </Chip>
                </div>

                <div
                  className="row"
                  style={{ gap: 22, justifyContent: "center", margin: "18px 0" }}
                >
                  <Envelope
                    label={wager.challenger.name}
                    sealed={
                      !wager.submissions.some((s) => s.athlete.handle === wager.challenger.handle)
                    }
                    commitment={
                      wager.submissions.find((s) => s.athlete.handle === wager.challenger.handle)
                        ?.commitment
                    }
                    title="sealed submission — commitment on-chain; the value is revealed only at settlement"
                  />
                  <span className="faint mono">vs</span>
                  <Envelope
                    label={wager.opponent.name}
                    sealed={
                      !wager.submissions.some((s) => s.athlete.handle === wager.opponent.handle)
                    }
                    commitment={
                      wager.submissions.find((s) => s.athlete.handle === wager.opponent.handle)
                        ?.commitment
                    }
                    title="sealed submission — commitment on-chain; the value is revealed only at settlement"
                  />
                </div>

                {wager.status === "open" && wager.challenger.role === "local" ? (
                  <Notice tone="info">
                    Waiting for the opponent to accept — their wallet must accept this challenge (ID{" "}
                    {wager.id}).
                  </Notice>
                ) : null}

                {wager.status === "open" && (isLive || wager.opponent.role === "local") ? (
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

                {isLive && wager.status === "accepted" ? (
                  <div className="row" style={{ gap: 10 }}>
                    <Button
                      tone="seal"
                      block
                      disabled={
                        busyId !== null || submittedBy(wager, wager.challenger) || submitLock.locked
                      }
                      title={submitLock.locked ? submitLock.label : undefined}
                      onClick={() =>
                        void run(wager.id, () =>
                          submitWorkout(wager.id, athleteOf(wager.challenger)),
                        )
                      }
                    >
                      {busyId === wager.id ? <span className="spin" /> : null}
                      {submittedBy(wager, wager.challenger)
                        ? "Sealed ✓"
                        : `Seal ${wager.challenger.name}'s submission${submitLock.locked ? ` — ${submitLock.label}` : ""}`}
                    </Button>
                    <Button
                      tone="seal"
                      block
                      disabled={
                        busyId !== null || submittedBy(wager, wager.opponent) || submitLock.locked
                      }
                      title={submitLock.locked ? submitLock.label : undefined}
                      onClick={() =>
                        void run(wager.id, () => submitWorkout(wager.id, athleteOf(wager.opponent)))
                      }
                    >
                      {busyId === wager.id ? <span className="spin" /> : null}
                      {submittedBy(wager, wager.opponent)
                        ? "Sealed ✓"
                        : `Seal ${wager.opponent.name}'s submission${submitLock.locked ? ` — ${submitLock.label}` : ""}`}
                    </Button>
                  </div>
                ) : null}

                {isWallet && wager.status === "accepted" ? (
                  <Button
                    tone="seal"
                    block
                    disabled={
                      busyId !== null ||
                      submittedBy(wager, localSide(wager)) ||
                      !myCredentialId ||
                      submitLock.locked
                    }
                    title={
                      submitLock.locked
                        ? submitLock.label
                        : myCredentialId
                          ? "Seals the latest attested workout — the value stays sealed until settle"
                          : "Attest a workout first (Connect tab)"
                    }
                    onClick={() =>
                      void run(wager.id, () => submitWorkout(wager.id, myCredentialId))
                    }
                  >
                    {busyId === wager.id ? <span className="spin" /> : null}
                    {submittedBy(wager, localSide(wager))
                      ? "Sealed ✓ — waiting for the opponent"
                      : submitLock.locked
                        ? `Submissions closed — ${submitLock.label}`
                        : myCredentialId
                          ? "Seal my submission (latest attested workout)"
                          : "Attest a workout first"}
                  </Button>
                ) : null}

                {wager.status === "accepted" && wager.submissions.length === 1 ? (
                  <Notice tone="info">Waiting for the other athlete's sealed submission…</Notice>
                ) : null}

                {readyToSettle ? (
                  <Button
                    tone="gold"
                    block
                    disabled={busyId !== null || lock.locked}
                    onClick={() => void run(wager.id, () => settleWager(wager.id))}
                  >
                    {busyId === wager.id ? <span className="spin" /> : null}
                    {settleLabel(wager)} under seal{lock.locked ? ` (${lock.label})` : ""}
                  </Button>
                ) : null}

                {wager.status === "settled" && wager.result ? (
                  <Notice tone={wager.result.tie || wager.result.forfeit ? "info" : "success"}>
                    {wager.result.summary} · pot {fmtTnight(wager.result.pot)}{" "}
                    {wager.result.currency} ·{" "}
                    {wager.result.disclosed
                      ? "the comparison was revealed on-chain at settlement"
                      : "comparison not disclosed"}
                    {wager.result.nft ? " · shielded NFT to the winner" : ""}
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
            Sealed submission commitments land on-chain as{" "}
            <code className="mono">persistentCommit</code> envelopes — hover them:{" "}
            <code className="mono">{hexShort("0x" + "0".repeat(64), 10, 8)}</code> style. The values
            stay sealed until the deadline; at settlement the chain reveals both openings to decide
            the winner — never before.
          </Notice>
        </div>
      ) : null}

      <CreateWagerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        isWallet={isWallet}
      />
    </div>
  );
};

const athleteOf = (athlete: Athlete): "A" | "B" =>
  athlete.handle === ATHLETE_B.handle ? "B" : "A";

// Wallet mode: the athlete object of MY side (the client maps the local role).
const localSide = (wager: WagerView): Athlete =>
  wager.challenger.role === "local" ? wager.challenger : wager.opponent;

// Wallet mode challenge input: the opponent's 64-hex holder binding
// (their challenge ID, copied from their Connect tab). Accepts bare hex.
const normalizeChallengeBinding = (input: string): string | null => {
  const hex = input.trim().replace(/^0x/, "");
  return /^[0-9a-fA-F]{64}$/.test(hex) ? "0x" + hex.toLowerCase() : null;
};

const CreateWagerModal = ({
  open,
  onClose,
  onCreate,
  isWallet,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (req: WagerCreateRequest) => Promise<void>;
  isWallet: boolean;
}) => {
  const [metricId, setMetricId] = useState<string>("1");
  const [stake, setStake] = useState("10");
  const [deadline, setDeadline] = useState("90");
  const [challengeId, setChallengeId] = useState<string>("");
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const opponentOf = (): Athlete => {
    if (!isWallet) {
      const parsed = challengeIdOf(challengeId);
      if (parsed === "B") return ATHLETE_B;
      if (parsed === "A") return ATHLETE_A;
      return ATHLETE_B;
    }
    const binding = normalizeChallengeBinding(challengeId);
    if (!binding) return ATHLETE_B;
    return {
      name: `Athlete ${hexShort(binding, 8, 6)}`,
      handle: hexShort(binding, 8, 6),
      role: "opponent",
      holderBinding: binding,
    };
  };

  const validateChallenge = (): boolean => {
    if (isWallet) {
      if (normalizeChallengeBinding(challengeId) === null) {
        setChallengeError(
          "challenge ID must be the opponent\u2019s 64-hex holder binding (their Connect tab)",
        );
        return false;
      }
    } else if (challengeIdOf(challengeId) === null) {
      setChallengeError("unknown challenge ID — the roster IDs are A (Ava) and B (Milo)");
      return false;
    }
    setChallengeError(null);
    return true;
  };

  const submit = async () => {
    if (!validateChallenge()) return;
    setSaving(true);
    try {
      await onCreate({
        opponent: opponentOf(),
        metricId: BigInt(metricId),
        stake: Number(stake),
        deadlineBlock: BigInt(Math.floor(Date.now() / 1000) + Number(deadline)),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="card-title">Create wager</h3>
      <div className="field">
        <label htmlFor="wager-opponent">
          {isWallet
            ? "Opponent — their holder-binding challenge ID (0x + 64 hex, from their Connect tab)"
            : "Opponent — challenge by ID (A = Ava, B = Milo)"}
        </label>
        <input
          id="wager-opponent"
          className="input"
          placeholder={
            isWallet ? "0x4f8c… (paste the opponent\u2019s challenge ID)" : "Challenge ID, e.g. B"
          }
          value={challengeId}
          onChange={(e) => setChallengeId(e.target.value)}
        />
        {challengeError ? (
          <div style={{ marginTop: 6 }}>
            <Notice tone="error">{challengeError}</Notice>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="wager-metric">Metric</label>
        <select
          id="wager-metric"
          className="select"
          value={metricId}
          onChange={(e) => setMetricId(e.target.value)}
        >
          {METRICS.map((m) => (
            <option key={m.id.toString()} value={m.id.toString()}>
              {m.label} ({m.unit})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wager-stake">Stake (NIGHT)</label>
        <input
          id="wager-stake"
          className="input"
          type="number"
          min={1}
          value={stake}
          onChange={(e) => setStake(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="wager-deadline">Deadline (seconds from now)</label>
        <input
          id="wager-deadline"
          className="input"
          type="number"
          min={1}
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
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
          {isWallet
            ? `Challenging ${opponentOf().name}. The ${stake} NIGHT stake is escrowed on-chain for real; the winner takes both sides plus a shielded NFT. The opponent accepts from their own wallet.`
            : `Challenging ${opponentOf().name} (${athleteOf(opponentOf())}). The ${stake} NIGHT stake is escrowed on-chain for real; the winner takes both sides plus a shielded NFT.`}
        </Notice>
      </div>
    </Modal>
  );
};
