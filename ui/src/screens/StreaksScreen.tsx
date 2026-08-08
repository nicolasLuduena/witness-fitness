import { Award, Check, Flame, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button, Notice } from "../components/bits";
import type { BadgeView } from "../domain/types";
import { logError } from "../lib/logger";
import { navigateTo } from "../lib/navigation";
import { useDemo } from "../state/DemoStore";

export const StreaksScreen = () => {
  const { streak, badges, session, credentials, advanceStreak, mintBadge } = useDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      logError("StreaksScreen.action", err);
      setError(err instanceof Error ? err.message : "We couldn't complete that action. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const current = streak?.current ?? 0;
  const hasCredential = credentials.length > 0;
  const streakBadge = badges.find((badge) => badge.id === 1);
  const distanceBadge = badges.find((badge) => badge.id === 2);

  return (
    <div className="page page--streak">
      <header className="page-heading page-heading--compact">
        <div>
          <p className="page-context">Streak &amp; badges</p>
          <h1>{current > 0 ? `${current}-day private streak` : "Make consistency provable."}</h1>
          <p>
            Link attested days without publishing dates, distances, or activities. Mint a badge when
            the contract confirms the requirement.
          </p>
        </div>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {!session || !hasCredential ? (
        <section className="empty-journey" aria-labelledby="streak-empty-title">
          <LockKeyhole aria-hidden="true" />
          <div>
            <h2 id="streak-empty-title">
              {!session ? "Connect before starting a streak" : "Attest a workout first"}
            </h2>
            <p>
              {!session
                ? "A private athlete identity is required to hold your sealed streak."
                : "Your latest attested activity becomes the next private link in the chain."}
            </p>
          </div>
          <Button tone="primary" onClick={() => navigateTo("account")}>
            {!session ? "Connect wallet" : "Attest workout"}
          </Button>
        </section>
      ) : (
        <>
          <section className="streak-course" aria-labelledby="streak-course-title">
            <div className="streak-course__path" aria-hidden="true">
              {[1, 2, 3].map((day) => {
                const complete = current >= day;
                const active = !complete && day === Math.min(current + 1, 3);
                return (
                  <div
                    key={day}
                    className={`streak-node ${complete ? "streak-node--complete" : ""} ${active ? "streak-node--active" : ""}`}
                  >
                    <span>{complete ? <Check /> : day}</span>
                    <div>
                      <strong>
                        {day === Math.min(current + 1, 3) && !complete ? "Today" : `Day ${day}`}
                      </strong>
                      <small>
                        {complete ? "Attested" : active ? "Ready to continue" : "Locked"}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="streak-course__action">
              <div className="action-symbol">
                <Flame aria-hidden="true" />
              </div>
              <div>
                <p className="section-label">Current action</p>
                <h2 id="streak-course-title">
                  {current >= 3 ? "Your streak badge is ready" : "Continue your private streak"}
                </h2>
                <p>
                  {current >= 3
                    ? "The contract has confirmed three consecutive attested days."
                    : "This uses your latest attested workout. The activity and its value remain on your device."}
                </p>
              </div>
              {current < 3 ? (
                <Button
                  tone="primary"
                  disabled={busy !== null}
                  onClick={() => void run("advance", () => advanceStreak())}
                >
                  {busy === "advance" ? <span className="spin" /> : null}
                  Continue streak
                </Button>
              ) : null}
            </div>

            <details className="verification-details">
              <summary>
                <ShieldCheck aria-hidden="true" /> How the streak stays private
              </summary>
              <div>
                <p>
                  Each day adds a sealed credential to a continuity proof. The public ledger stores
                  the chain commitment—not your activity, date, or distance.
                </p>
                {streak?.chainId ? <code>{streak.chainId}</code> : null}
              </div>
            </details>
          </section>

          <section className="badge-section" aria-labelledby="badges-title">
            <header>
              <div>
                <p className="section-label">Earned on-chain</p>
                <h2 id="badges-title">Badges</h2>
              </div>
              <p>Mint only when a private requirement is satisfied.</p>
            </header>
            <div className="badge-list">
              <BadgeRow
                badge={streakBadge}
                fallbackLabel="Streak of 3"
                fallbackRequirement="3 consecutive attested workout days"
                ready={current >= 3}
                busy={busy === "mint1"}
                disabled={busy !== null}
                onMint={() => void run("mint1", () => mintBadge(1))}
              />
              <BadgeRow
                badge={distanceBadge}
                fallbackLabel="Centurion"
                fallbackRequirement="One attested distance of at least 10 km"
                ready={
                  Boolean(distanceBadge?.minted) ||
                  credentials.some(
                    (credential) => credential.metric.id === 1n && credential.value >= 10_000,
                  )
                }
                busy={busy === "mint2"}
                disabled={busy !== null}
                onMint={() => void run("mint2", () => mintBadge(2))}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const BadgeRow = ({
  badge,
  fallbackLabel,
  fallbackRequirement,
  ready,
  busy,
  disabled,
  onMint,
}: {
  badge?: BadgeView;
  fallbackLabel: string;
  fallbackRequirement: string;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  onMint: () => void;
}) => {
  const minted = badge?.minted ?? false;
  return (
    <article
      className={`badge-row ${minted ? "badge-row--minted" : ready ? "badge-row--ready" : ""}`}
    >
      <div className="badge-mark" aria-hidden="true">
        {minted ? <Check /> : ready ? <Award /> : <LockKeyhole />}
      </div>
      <div className="badge-row__copy">
        <div className="badge-row__heading">
          <h3>{badge?.label ?? fallbackLabel}</h3>
          <span>{minted ? "Minted" : ready ? "Ready" : "Locked"}</span>
        </div>
        <p>{badge?.requirement ?? fallbackRequirement}</p>
        <small>
          {minted
            ? "The badge is recorded. Its source workouts remain sealed."
            : ready
              ? "Requirement confirmed. Minting creates the on-chain badge."
              : "Keep training—only the completed requirement becomes provable."}
        </small>
      </div>
      <Button
        tone={ready && !minted ? "primary" : "ghost"}
        disabled={disabled || !ready || minted}
        onClick={onMint}
      >
        {busy ? <span className="spin" /> : null}
        {minted ? "Badge minted" : ready ? "Mint badge" : "Not ready"}
      </Button>
    </article>
  );
};
