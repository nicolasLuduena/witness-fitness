// Employer — the third-party verification screen (the showpiece). A mock
// employer's wellness panel verifies badge claims via proveBadge; the streak
// data stays sealed. This screen reads nothing the chain didn't publish.

import { useState } from "react";
import { Button, Card, Notice } from "../components/bits";
import { EMPLOYER } from "../domain/story";
import { logError } from "../lib/logger";
import { useDemo } from "../state/DemoStore";

export const EmployerScreen = () => {
  const { badges, proofs, proveBadge, streak } = useDemo();
  const [badgeId, setBadgeId] = useState("1");
  const [verifier, setVerifier] = useState(EMPLOYER.holderBinding);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = badges.find((b) => b.id === Number(badgeId));
  const minted = badge?.minted ?? false;

  const submit = async () => {
    setError(null);
    setRunning(true);
    try {
      await proveBadge(Number(badgeId), verifier);
    } catch (err) {
      logError("EmployerScreen.proveBadge", err);
      setError(err instanceof Error ? err.message : "proof failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Employer panel — verify without seeing</h1>
        <p className="screen-sub">
          {EMPLOYER.name} (a mock wellness program) verifies that an athlete holds a badge —{" "}
          <strong>no workouts, no dates, no distances</strong>. The chain answers with a proof, not
          a story.
        </p>
      </div>

      <div className="grid-2">
        <Card title="Verifier terminal" glow>
          <div className="field">
            <label htmlFor="employer-badge">Badge to verify</label>
            <select
              id="employer-badge"
              className="select"
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
            >
              {badges.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.minted}>
                  {b.label} {b.minted ? "(minted)" : "(not minted)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="employer-verifier">
              Verifier binding (0x + 64 hex — the third party's holder binding)
            </label>
            <input
              id="employer-verifier"
              className="input mono"
              value={verifier}
              onChange={(e) => setVerifier(e.target.value)}
            />
          </div>
          <Button tone="primary" block onClick={() => void submit()} disabled={running || !minted}>
            {running ? <span className="spin" /> : null}
            Run proveBadge({badgeId}, verifier)
          </Button>
          {!minted ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="warn">
                Badge not minted yet — mint it on the Streaks &amp; Badges tab (streak is currently{" "}
                {streak?.current ?? 0}/3 days).
              </Notice>
            </div>
          ) : null}
          {error ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </Card>

        <Card title="Verification transcript">
          {proofs.length === 0 ? (
            <div className="empty-state">
              No proofs yet. The transcript fills here — each line is a real on-chain{" "}
              <code className="mono">proveBadge</code> receipt.
            </div>
          ) : (
            <div className="employer-frame">
              <div className="employer-bar">
                <div className="wax" style={{ width: 18, height: 18 }} />
                <strong>{EMPLOYER.name}</strong>
                <span className="faint">verification ledger</span>
              </div>
              {proofs.map((proof) => (
                <div key={proof.proofId} className="verify-line verify-line--ok">
                  <span>✓</span>
                  <div>
                    <div>{proof.statement}</div>
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      verifier {proof.verifier} · proof {proof.proofId.slice(0, 18)}… ·{" "}
                      {new Date(proof.verifiedAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              <div className="verify-line verify-line--sealed">
                <span>🔒</span> athlete streak data: <strong>sealed</strong> — never part of the
                proof
              </div>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Notice tone="success">
          This is the B2B2C wedge: an employer can run a wellness incentive without ever touching
          health data — the platform never sees it either. Attestation backends are pluggable
          (Reclaim today; TEEs / MPC-TLS later) and the vault stays the same.
        </Notice>
      </div>
    </div>
  );
};
