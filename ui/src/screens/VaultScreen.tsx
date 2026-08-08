// Vault — the user's sealed credentials. Shows commitments, timestamps, and
// what is PROVABLE (metric chips) — never raw values, except for the local
// athlete's own last value (which lives only on their machine).

import { Card, Chip, Notice } from "../components/bits";
import { Envelope } from "../components/Envelope";
import { fmtDate, fmtKm, fmtMinutes, timeAgo } from "../lib/format";
import { useDemo } from "../state/DemoStore";

export const VaultScreen = () => {
  const { credentials, session } = useDemo();

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Vault — sealed credentials</h1>
        <p className="screen-sub">
          Each entry is a <code className="mono">persistentCommit</code> bound to your holder
          secret. The chain knows <em>what you can prove</em> — never what it was. Hover an
          envelope.
        </p>
      </div>

      {credentials.length === 0 ? (
        <div className="empty-state">
          No credentials yet. Attest a workout on the Connect tab
          {session ? "" : " (enter the demo first)"}.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 18,
          }}
        >
          {credentials.map((cred, index) => {
            const isNewest = index === 0;
            return (
              <Card key={cred.id} title={isNewest ? "Newest attestation" : "Vaulted credential"}>
                <div className="row" style={{ marginBottom: 12 }}>
                  <Envelope
                    label={cred.athlete.name}
                    sealed={false}
                    landing={isNewest}
                    commitment={cred.commitment}
                    value={cred.metric.unit === "km" ? fmtKm(cred.value) : fmtMinutes(cred.value)}
                    title={`commitment on-chain: ${cred.commitment}`}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{fmtDate(cred.timestamp)}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      {timeAgo(cred.timestamp)}
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <Chip tone="provable">{cred.provableChips[0]}</Chip>
                    </div>
                  </div>
                </div>
                <div className="divider" />
                <div className="row-between faint" style={{ fontSize: 12.5 }}>
                  <span className="mono">commitment</span>
                  <span className="hash">{cred.commitment}</span>
                </div>
                {cred.txHash ? (
                  <div className="row-between faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    <span className="mono">transaction</span>
                    <span className="hash">{cred.txHash}</span>
                  </div>
                ) : null}
                <div className="row-between faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                  <span className="mono">notary signatures</span>
                  <span className="chip chip--gold">{cred.notarySignatures}/3</span>
                </div>
                <div className="row-between faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                  <span className="mono">source</span>
                  <span>
                    {cred.source === "demo-story" ? "demo session" : "attested-session replay"}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Notice tone="warn">
          The raw values above are shown to <strong>you only</strong> — they exist nowhere else: not
          in the ledger, not in the indexer, not in the notaries' memory. What the chain stores is
          the commitment you see under each envelope.
        </Notice>
      </div>
    </div>
  );
};
