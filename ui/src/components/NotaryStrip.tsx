// The always-visible trust strip: 3 notary keys, per-key status, and the
// 2-of-3 threshold stated plainly. The trust model visible in 3 seconds.

import { useDemo } from "../state/DemoStore";
import { Dot } from "./bits";

const THRESHOLD_COPY = [
  "any 2 of 3 must collude to forge a workout",
  "each instance independently verifies the Reclaim proof",
  "registered keys are verified inside the contract circuit",
];

export const NotaryStrip = () => {
  const { notaries, mode } = useDemo();
  const up = notaries.filter((n) => n.healthy).length;
  const sigs = notaries.reduce((sum, n) => sum + n.signatureCount, 0);

  return (
    <div className="notary-strip">
      <div className="notary-strip__head">
        <div className="notary-strip__title">
          <Dot
            tone={up >= 2 ? "green" : up === 0 ? "red" : "amber"}
            pulse={mode === "live" && up < 2}
          />
          Notary signers — oracle trust anchor
        </div>
        <div className="notary-strip__threshold">
          {up}/3 up · {sigs} signatures · threshold 2-of-3
        </div>
      </div>
      <div className="notary-keys">
        {notaries.length === 0
          ? [0, 1, 2].map((i) => (
              <div key={i} className="notary-key notary-key--down">
                <Dot tone="off" />
                <div>
                  <div className="notary-key__name">notary-{i + 1}</div>
                  <div className="notary-key__sub">probe…</div>
                </div>
              </div>
            ))
          : notaries.map((n) => (
              <div key={n.index} className={`notary-key ${n.healthy ? "" : "notary-key--down"}`}>
                <Dot tone={n.healthy ? "green" : "red"} />
                <div>
                  <div className="notary-key__name">{n.keyId}</div>
                  <div className="notary-key__sub">
                    {n.healthy ? n.pubkey.slice(0, 16) + "…" : "unreachable"}
                  </div>
                </div>
                <div className="notary-key__sigs">
                  {n.signatureCount > 0 ? `${n.signatureCount} sig` : "—"}
                </div>
              </div>
            ))}
      </div>
      <div className="divider" />
      <div className="faint" style={{ fontSize: 12.5 }}>
        {THRESHOLD_COPY[0]} · {THRESHOLD_COPY[1]} · {THRESHOLD_COPY[2]}
      </div>
    </div>
  );
};
