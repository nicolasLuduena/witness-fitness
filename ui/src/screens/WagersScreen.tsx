import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Coins,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Notice } from "../components/bits";
import { RevealSettle } from "../components/RevealSettle";
import { ATHLETE_A, ATHLETE_B } from "../domain/story";
import type { Athlete, WagerCreateRequest, WagerView } from "../domain/types";
import { METRICS } from "../domain/types";
import { fmtTnight, hexShort } from "../lib/format";
import { athleteLabel, opponentLabel } from "../lib/identity-label";
import { logError } from "../lib/logger";
import { navigateTo } from "../lib/navigation";
import { challengeIdOf, formatCountdown, settleReadyAtMs } from "../lib/wager-countdown";
import { useDemo } from "../state/DemoStore";

const statusLabel: Record<WagerView["status"], string> = {
  open: "Waiting for acceptance",
  accepted: "Ready to seal",
  submitted: "Submissions sealed",
  settled: "Settled",
  cancelled: "Cancelled",
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
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (selectedId === null && wagers.length > 0) {
      const active = wagers.find(
        (wager) => wager.status !== "settled" && wager.status !== "cancelled",
      );
      setSelectedId(active?.id ?? wagers[0].id);
    }
  }, [selectedId, wagers]);

  useEffect(() => {
    const awaiting = wagers.some(
      (wager) =>
        wager.status === "open" || wager.status === "accepted" || wager.status === "submitted",
    );
    if (!awaiting) return;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [wagers, refresh]);

  useEffect(() => {
    if (!wagers.some((wager) => wager.status !== "settled" && wager.status !== "cancelled")) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [wagers]);

  const selected = wagers.find((wager) => wager.id === selectedId) ?? wagers[0];
  const isWallet = mode === "wallet";
  const isLive = mode === "live";
  const myCredentialId = credentials[0]?.id;

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      logError("WagersScreen.action", err);
      setActionError(
        err instanceof Error ? err.message : "We couldn't update this wager. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (request: WagerCreateRequest) => {
    setActionError(null);
    try {
      const wager = await createWager(request);
      setSelectedId(wager.id);
      setCreating(false);
    } catch (err) {
      logError("WagersScreen.create", err);
      setActionError(
        err instanceof Error ? err.message : "We couldn't create the wager. Try again.",
      );
      throw err;
    }
  };

  if (creating) {
    return (
      <CreateWagerPage
        isWallet={isWallet}
        onBack={() => setCreating(false)}
        onCreate={handleCreate}
        error={actionError}
      />
    );
  }

  return (
    <div className="page page--wagers">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="page-context">Private wagers</p>
          <h1>Compete as a holder binding—not a profile.</h1>
          <p>
            Stake NIGHT, seal an attested result, and let the contract settle the outcome. Opponent
            names and wallet identities never enter the wager.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-action"
            onClick={() => void refresh()}
            aria-label="Refresh wagers"
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <Button tone="primary" disabled={!session} onClick={() => setCreating(true)}>
            Create private wager <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </header>

      {actionError ? <Notice tone="error">{actionError}</Notice> : null}

      {settleReveal ? (
        <section className="settlement-stage" aria-live="polite">
          <RevealSettle result={settleReveal} />
          <Button tone="ghost" onClick={clearSettleReveal}>
            Return to wagers
          </Button>
        </section>
      ) : null}

      {!session ? (
        <section className="empty-journey" aria-labelledby="wager-connect-title">
          <LockKeyhole aria-hidden="true" />
          <div>
            <h2 id="wager-connect-title">Connect your private athlete identity</h2>
            <p>
              Your wallet funds transactions but is never used as your opponent-facing identity.
            </p>
          </div>
          <Button tone="primary" onClick={() => navigateTo("account")}>
            Connect wallet
          </Button>
        </section>
      ) : wagers.length === 0 ? (
        <section className="empty-journey" aria-labelledby="wager-empty-title">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="wager-empty-title">No private wagers yet</h2>
            <p>
              Paste another athlete's holder binding, choose the terms, and escrow your stake. Their
              name and wallet never become part of the challenge.
            </p>
          </div>
          <Button tone="primary" onClick={() => setCreating(true)}>
            Create private wager
          </Button>
        </section>
      ) : (
        <div className="wager-workspace">
          <aside className="wager-list" aria-label="Your wagers">
            <div className="wager-list__heading">
              <h2>Your wagers</h2>
              <span>{wagers.length}</span>
            </div>
            {wagers.map((wager) => (
              <button
                key={wager.id}
                className={
                  selected?.id === wager.id
                    ? "wager-list-item wager-list-item--active"
                    : "wager-list-item"
                }
                onClick={() => setSelectedId(wager.id)}
                aria-current={selected?.id === wager.id ? "true" : undefined}
              >
                <span className="wager-list-item__top">
                  <strong>Wager #{wager.id}</strong>
                  <small>{statusLabel[wager.status]}</small>
                </span>
                <span className="wager-list-item__pair">
                  {athleteLabel(wager.challenger)} ↔ {athleteLabel(wager.opponent)}
                </span>
                <span>
                  {fmtTnight(wager.stake)} NIGHT · {wager.metric.label}
                </span>
              </button>
            ))}
          </aside>

          {selected ? (
            <WagerDetail
              wager={selected}
              now={now}
              isWallet={isWallet}
              isLive={isLive}
              myCredentialId={myCredentialId}
              busy={busyId === selected.id}
              onAccept={() => run(selected.id, () => acceptWager(selected.id))}
              onSubmit={(credential) =>
                run(selected.id, () => submitWorkout(selected.id, credential))
              }
              onSettle={() => run(selected.id, () => settleWager(selected.id))}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};

const WagerDetail = ({
  wager,
  now,
  isWallet,
  isLive,
  myCredentialId,
  busy,
  onAccept,
  onSubmit,
  onSettle,
}: {
  wager: WagerView;
  now: number;
  isWallet: boolean;
  isLive: boolean;
  myCredentialId?: string;
  busy: boolean;
  onAccept: () => Promise<unknown>;
  onSubmit: (credential: string) => Promise<unknown>;
  onSettle: () => Promise<unknown>;
}) => {
  const submittedBy = (athlete: Athlete) =>
    wager.submissions.some((submission) => submission.athlete.handle === athlete.handle);
  const localAthlete = wager.challenger.role === "local" ? wager.challenger : wager.opponent;
  const localSubmitted = submittedBy(localAthlete);
  const deadlineMs = Number(wager.deadlineBlock) * 1_000;
  const submissionsClosed = wager.deadlineBlock > 0n && deadlineMs <= now;
  const settleReadyAt = settleReadyAtMs(wager.deadlineBlock);
  const settleLocked = wager.deadlineBlock > 0n && settleReadyAt > now;
  const canAccept = wager.status === "open" && (isLive || wager.opponent.role === "local");
  const canSettle = wager.status === "accepted" || wager.status === "submitted";
  const currentStep = stepForWager(wager, settleLocked);

  return (
    <article className="wager-detail">
      <header className="wager-detail__heading">
        <div>
          <p className="section-label">Wager #{wager.id}</p>
          <h2>{headingForWager(wager, settleLocked)}</h2>
          <p>{copyForWager(wager, settleLocked)}</p>
        </div>
        <span className={`state-label state-label--${wager.status}`}>
          {statusLabel[wager.status]}
        </span>
      </header>

      <Course currentStep={currentStep} settled={wager.status === "settled"} />

      <div className="current-stage">
        <section className="wager-terms" aria-labelledby={`wager-${wager.id}-terms`}>
          <h3 id={`wager-${wager.id}-terms`}>Wager terms</h3>
          <dl>
            <div>
              <dt>
                <UserRound aria-hidden="true" /> Opponent
              </dt>
              <dd>{opponentLabel(wager.opponent)}</dd>
              <small>No name or wallet is linked on-chain.</small>
            </div>
            <div>
              <dt>
                <Coins aria-hidden="true" /> Stake
              </dt>
              <dd>{fmtTnight(wager.stake)} NIGHT</dd>
            </div>
            <div>
              <dt>
                <CalendarClock aria-hidden="true" /> Deadline
              </dt>
              <dd>
                {new Date(deadlineMs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
              <small>
                {settleLocked
                  ? `Settlement opens in ${formatCountdown(settleReadyAt - now)}`
                  : "Settlement window open"}
              </small>
            </div>
          </dl>
        </section>

        <section className="stage-action" aria-live="polite">
          <StageActionIcon step={currentStep} />
          <div className="stage-action__copy">
            <p className="section-label">Current action</p>
            <h3>{actionHeading(wager, settleLocked)}</h3>
            <p>{actionCopy(wager, settleLocked, localSubmitted)}</p>
          </div>

          {canAccept ? (
            <Button tone="primary" disabled={busy} onClick={() => void onAccept()}>
              {busy ? <span className="spin" /> : null} Accept challenge
            </Button>
          ) : null}

          {isWallet && wager.status === "accepted" && !localSubmitted ? (
            <Button
              tone="primary"
              disabled={busy || !myCredentialId || submissionsClosed}
              onClick={() => myCredentialId && void onSubmit(myCredentialId)}
            >
              {busy ? <span className="spin" /> : null}
              {submissionsClosed
                ? "Submissions closed"
                : myCredentialId
                  ? "Seal my workout"
                  : "Attest a workout first"}
            </Button>
          ) : null}

          {isLive && wager.status === "accepted" ? (
            <div className="debug-actions" aria-label="Maintainer debug submissions">
              <Button
                tone="primary"
                disabled={busy || submittedBy(wager.challenger) || submissionsClosed}
                onClick={() => void onSubmit(athleteOf(wager.challenger))}
              >
                {submittedBy(wager.challenger) ? "Side A sealed" : "Seal side A"}
              </Button>
              <Button
                tone="ghost"
                disabled={busy || submittedBy(wager.opponent) || submissionsClosed}
                onClick={() => void onSubmit(athleteOf(wager.opponent))}
              >
                {submittedBy(wager.opponent) ? "Side B sealed" : "Seal side B"}
              </Button>
            </div>
          ) : null}

          {canSettle ? (
            <Button tone="primary" disabled={busy || settleLocked} onClick={() => void onSettle()}>
              {busy ? <span className="spin" /> : null}
              {settleLocked ? `Settle in ${formatCountdown(settleReadyAt - now)}` : "Settle wager"}
            </Button>
          ) : null}

          {wager.status === "settled" && wager.result ? (
            <div className="settled-summary">
              <Check aria-hidden="true" />
              <span>
                <strong>{wager.result.summary}</strong>
                {fmtTnight(wager.result.pot)} {wager.result.currency} settled.
              </span>
            </div>
          ) : null}

          <div className="privacy-note">
            <LockKeyhole aria-hidden="true" />
            <span>Only you see your workout. The contract receives a sealed commitment.</span>
          </div>
        </section>
      </div>

      <details className="verification-details">
        <summary>
          <ShieldCheck aria-hidden="true" /> How this is verified
        </summary>
        <div>
          <p>
            Two independent notaries verify the attested activity before the contract accepts its
            commitment. Holder bindings identify the two sides without names or wallet addresses.
          </p>
          <dl className="technical-receipt">
            <div>
              <dt>Challenger</dt>
              <dd>
                <code>{hexShort(wager.challenger.holderBinding, 10, 8)}</code>
              </dd>
            </div>
            <div>
              <dt>Opponent</dt>
              <dd>
                <code>{hexShort(wager.opponent.holderBinding, 10, 8)}</code>
              </dd>
            </div>
            <div>
              <dt>Submissions</dt>
              <dd>{wager.submissions.length}/2 sealed</dd>
            </div>
          </dl>
        </div>
      </details>
    </article>
  );
};

const COURSE = ["Connect", "Attest", "Challenge", "Seal", "Wait", "Settle"];

const Course = ({ currentStep, settled }: { currentStep: number; settled: boolean }) => (
  <ol className="course" aria-label="Wager progress">
    {COURSE.map((label, index) => {
      const complete = settled || index < currentStep;
      const active = !settled && index === currentStep;
      return (
        <li
          key={label}
          className={`${complete ? "course__step--complete" : ""} ${active ? "course__step--active" : ""}`}
          aria-current={active ? "step" : undefined}
        >
          <span>{complete ? <Check aria-hidden="true" /> : index + 1}</span>
          <strong>{label}</strong>
        </li>
      );
    })}
  </ol>
);

const StageActionIcon = ({ step }: { step: number }) => (
  <div className="action-symbol" aria-hidden="true">
    {step >= 4 ? <CalendarClock /> : step === 3 ? <LockKeyhole /> : <ShieldCheck />}
  </div>
);

const stepForWager = (wager: WagerView, settleLocked: boolean): number => {
  if (wager.status === "settled") return 5;
  if (wager.status === "cancelled") return 2;
  if (wager.status === "open") return 2;
  if (wager.status === "accepted" && wager.submissions.length === 0) return 3;
  if (settleLocked) return 4;
  return 5;
};

const headingForWager = (wager: WagerView, settleLocked: boolean): string => {
  if (wager.status === "cancelled") return "Wager cancelled";
  if (wager.status === "open") return "Challenge sent";
  if (wager.status === "accepted" && wager.submissions.length === 0) return "Challenge ready";
  if (wager.status === "settled") return "Wager settled";
  return settleLocked ? "Both sides are under seal" : "Settlement is ready";
};

const copyForWager = (wager: WagerView, settleLocked: boolean): string => {
  if (wager.status === "cancelled")
    return "This challenge is closed and no further action is available.";
  if (wager.status === "open")
    return "The anonymous opponent must accept before either side can seal a workout.";
  if (wager.status === "accepted" && wager.submissions.length === 0)
    return "Use your latest attested workout to lock your submission.";
  if (wager.status === "settled") return "The contract enforced the terms and moved the pot.";
  return settleLocked
    ? "The contract is holding the commitments until the deadline."
    : "The deadline has passed. Either side can settle.";
};

const actionHeading = (wager: WagerView, settleLocked: boolean): string => {
  if (wager.status === "cancelled") return "No further action";
  if (wager.status === "open")
    return wager.opponent.role === "local" ? "Accept this challenge" : "Waiting for acceptance";
  if (wager.status === "accepted" && wager.submissions.length < 2)
    return "Seal the eligible workout";
  if (wager.status === "settled") return "Outcome confirmed";
  return settleLocked ? "Wait for the settlement window" : "Settle the wager";
};

const actionCopy = (wager: WagerView, settleLocked: boolean, localSubmitted: boolean): string => {
  if (wager.status === "cancelled")
    return "The wager remains in your history as a private receipt.";
  if (wager.status === "open") return "Acceptance binds the pseudonymous holder to these terms.";
  if (wager.status === "accepted" && localSubmitted)
    return "Your commitment is sealed. Waiting for the other holder binding.";
  if (wager.status === "accepted")
    return "The value stays on your device while a commitment is added to the contract.";
  if (wager.status === "settled")
    return "The result is final. Athlete and wallet identities remain unlinked.";
  return settleLocked
    ? "No further action is needed until settlement opens."
    : "Settlement compares the submitted openings and pays the result.";
};

const athleteOf = (athlete: Athlete): "A" | "B" =>
  athlete.handle === ATHLETE_B.handle ? "B" : "A";

const normalizeChallengeBinding = (input: string): string | null => {
  const hex = input.trim().replace(/^0x/, "");
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex.toLowerCase()}` : null;
};

const CreateWagerPage = ({
  isWallet,
  onBack,
  onCreate,
  error,
}: {
  isWallet: boolean;
  onBack: () => void;
  onCreate: (request: WagerCreateRequest) => Promise<void>;
  error: string | null;
}) => {
  const [metricId, setMetricId] = useState("1");
  const [stake, setStake] = useState("10");
  const [deadline, setDeadline] = useState("90");
  const [challengeId, setChallengeId] = useState("");
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const opponent = useMemo<Athlete>(() => {
    if (!isWallet) {
      return challengeIdOf(challengeId) === "A" ? ATHLETE_A : ATHLETE_B;
    }
    const binding = normalizeChallengeBinding(challengeId) ?? ATHLETE_B.holderBinding;
    return {
      name: "Anonymous athlete",
      handle: hexShort(binding, 8, 6),
      role: "opponent",
      holderBinding: binding,
    };
  }, [challengeId, isWallet]);

  const submit = async () => {
    const normalized = isWallet
      ? normalizeChallengeBinding(challengeId)
      : challengeIdOf(challengeId);
    if (!normalized) {
      setChallengeError(
        isWallet
          ? "Paste the opponent's 64-character holder binding. It starts with 0x."
          : "Use demo holder side A or B.",
      );
      return;
    }
    setChallengeError(null);
    setSaving(true);
    try {
      await onCreate({
        opponent,
        metricId: BigInt(metricId),
        stake: Number(stake),
        deadlineBlock: BigInt(Math.floor(Date.now() / 1_000) + Number(deadline)),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page create-wager-page">
      <button className="back-action" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> Back to wagers
      </button>
      <header className="page-heading page-heading--compact">
        <div>
          <p className="page-context">New private wager</p>
          <h1>Set the terms. Keep both identities out.</h1>
          <p>
            The opponent is represented only by a holder binding. No name or wallet address is
            requested.
          </p>
        </div>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="create-wager-layout">
        <form
          className="wager-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor="wager-opponent">Opponent holder binding</label>
            <input
              id="wager-opponent"
              className="input"
              placeholder={isWallet ? "0x…64-character holder binding" : "Demo side A or B"}
              value={challengeId}
              onChange={(event) => setChallengeId(event.target.value)}
              aria-describedby="wager-opponent-hint wager-opponent-error"
              aria-invalid={Boolean(challengeError)}
              autoComplete="off"
            />
            <small id="wager-opponent-hint">
              Copied from the other athlete's private account screen.
            </small>
            {challengeError ? (
              <p className="field-error" id="wager-opponent-error">
                {challengeError}
              </p>
            ) : null}
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="wager-metric">Winning metric</label>
              <select
                id="wager-metric"
                className="select"
                value={metricId}
                onChange={(event) => setMetricId(event.target.value)}
              >
                {METRICS.map((metric) => (
                  <option key={metric.id.toString()} value={metric.id.toString()}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="wager-stake">Your stake (NIGHT)</label>
              <input
                id="wager-stake"
                className="input"
                type="number"
                min="1"
                value={stake}
                onChange={(event) => setStake(event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="wager-deadline">Submission window (seconds)</label>
            <input
              id="wager-deadline"
              className="input"
              type="number"
              min="1"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
            <small>Settlement opens after this window plus the contract's grace period.</small>
          </div>

          <Button tone="primary" block disabled={saving} type="submit">
            {saving ? <span className="spin" /> : null} Create and escrow {stake || "0"} NIGHT
          </Button>
        </form>

        <aside className="wager-review" aria-label="Wager privacy review">
          <p className="section-label">Before you create</p>
          <h2>Private by construction</h2>
          <ul>
            <li>
              <Check aria-hidden="true" />
              <span>
                <strong>Pseudonymous opponent</strong>
                {challengeId ? opponentLabel(opponent) : "Waiting for a holder binding"}
              </span>
            </li>
            <li>
              <Check aria-hidden="true" />
              <span>
                <strong>Sealed workout</strong>The raw result stays on each athlete's device until
                settlement.
              </span>
            </li>
            <li>
              <Check aria-hidden="true" />
              <span>
                <strong>Contract-enforced terms</strong>The stake and deadline cannot be changed
                after creation.
              </span>
            </li>
          </ul>
          <div className="privacy-note">
            <LockKeyhole aria-hidden="true" />
            <span>
              The chain never receives an athlete name, profile, or linked wallet identity.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
};
