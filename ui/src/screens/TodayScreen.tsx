import { ArrowRight, Check, Flame, LockKeyhole, ShieldCheck, Trophy } from "lucide-react";
import { athleteLabel } from "../lib/identity-label";
import { navigateTo } from "../lib/navigation";
import { useDemo } from "../state/DemoStore";

export const TodayScreen = () => {
  const { session, credentials, wagers, streak, badges } = useDemo();
  const activeWager = wagers.find(
    (wager) => wager.status !== "settled" && wager.status !== "cancelled",
  );
  const minted = badges.filter((badge) => badge.minted).length;
  const ready = Boolean(session && credentials.length > 0);

  return (
    <div className="page page--today">
      <header className="today-hero">
        <div className="today-hero__copy">
          <p className="page-context">Today</p>
          <h1>
            {ready ? "Your next effort stays yours." : "Compete without publishing your workout."}
          </h1>
          <p>
            Use a real, attested activity in a private wager or turn consistent training into an
            on-chain badge.
          </p>
          <div className={`readiness ${ready ? "readiness--ready" : ""}`}>
            {ready ? <ShieldCheck aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            <span>
              <strong>{ready ? "Ready" : "Setup needed"}</strong>
              {ready ? "Identity and workout are private" : "Connect once to get started"}
            </span>
          </div>
        </div>

        <figure className="today-hero__visual">
          <picture>
            <source srcSet="/images/witnessfitness-runner.webp" type="image/webp" />
            <img
              src="/images/witnessfitness-runner.png"
              alt="A runner training above a city at dawn"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <figcaption>
            <LockKeyhole aria-hidden="true" />
            <span>
              <strong>Seen here. Sealed on-chain.</strong>
              Athlete imagery is illustrative; identities stay private.
            </span>
          </figcaption>
        </figure>
      </header>

      {!session ? (
        <section className="primary-journey" aria-labelledby="setup-title">
          <div className="journey-index" aria-hidden="true">
            01
          </div>
          <div className="journey-copy">
            <h2 id="setup-title">Connect your private athlete identity</h2>
            <p>
              Your wallet pays fees, but it is never used as your public identity. WitnessFitness
              creates a separate holder binding for challenges.
            </p>
          </div>
          <button className="btn btn--primary journey-action" onClick={() => navigateTo("account")}>
            Connect wallet <ArrowRight aria-hidden="true" />
          </button>
        </section>
      ) : credentials.length === 0 ? (
        <section className="primary-journey" aria-labelledby="attest-title">
          <div className="journey-index" aria-hidden="true">
            02
          </div>
          <div className="journey-copy">
            <h2 id="attest-title">Attest your latest workout</h2>
            <p>
              Connect Strava and turn one real activity into a reusable private credential. The
              chain receives a commitment, not the workout.
            </p>
          </div>
          <button className="btn btn--primary journey-action" onClick={() => navigateTo("account")}>
            Attest workout <ArrowRight aria-hidden="true" />
          </button>
        </section>
      ) : (
        <section className="primary-journey" aria-labelledby="wager-next-title">
          <div className="journey-symbol">
            <Trophy aria-hidden="true" />
          </div>
          <div className="journey-copy">
            <p className="section-label">Private wager</p>
            <h2 id="wager-next-title">
              {activeWager ? `Continue wager #${activeWager.id}` : "Put your effort on the line"}
            </h2>
            <p>
              {activeWager
                ? `${activeWager.status === "open" ? "Waiting for the anonymous opponent to accept." : "Your challenge is moving through the private settlement course."}`
                : "Challenge an anonymous holder binding. The contract compares sealed results and pays the winner."}
            </p>
            {activeWager ? (
              <div className="anonymous-pair">
                <span>{athleteLabel(activeWager.challenger)}</span>
                <span aria-hidden="true">↔</span>
                <span>{athleteLabel(activeWager.opponent)}</span>
                <small>No names or wallets are linked on-chain.</small>
              </div>
            ) : null}
          </div>
          <button className="btn btn--primary journey-action" onClick={() => navigateTo("wagers")}>
            {activeWager ? "Open wager" : "Create private wager"} <ArrowRight aria-hidden="true" />
          </button>
        </section>
      )}

      <section className="today-secondary" aria-labelledby="streak-summary-title">
        <div className="streak-summary-icon">
          <Flame aria-hidden="true" />
        </div>
        <div>
          <p className="section-label">Streak &amp; badges</p>
          <h2 id="streak-summary-title">
            {streak?.current ? `${streak.current}-day private streak` : "Start a private streak"}
          </h2>
          <p>
            {minted > 0
              ? `${minted} badge${minted === 1 ? "" : "s"} minted. Your underlying workouts remain sealed.`
              : "Link consecutive attested days, then mint the achievement without publishing the activities."}
          </p>
        </div>
        <button className="text-action" onClick={() => navigateTo("streak")}>
          View progress <ArrowRight aria-hidden="true" />
        </button>
      </section>

      <section className="privacy-principles" aria-label="Privacy guarantees">
        <div>
          <Check aria-hidden="true" />
          <span>
            <strong>Real activity</strong>Attested from Strava
          </span>
        </div>
        <div>
          <LockKeyhole aria-hidden="true" />
          <span>
            <strong>Sealed by default</strong>Raw values stay private until settlement
          </span>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>Pseudonymous</strong>No athlete name or wallet identity on-chain
          </span>
        </div>
      </section>
    </div>
  );
};
