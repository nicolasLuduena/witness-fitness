// The attestation stepper — the "real crypto happening live" moment.
// Stages: witnessing TLS → proof generated → notarizing → on-chain.

import type { AttestationStage } from "../domain/types";

export const StatusLine = ({ stages }: { stages: AttestationStage[] }) => (
  <div className="steps">
    {stages.map((stage) => (
      <div
        key={stage.id}
        className={[
          "step",
          stage.state === "active" ? "step--active" : "",
          stage.state === "done" ? "step--done" : "",
          stage.state === "error" ? "step--error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="step__index">
          {stage.state === "done" ? "✓" : stage.state === "error" ? "✕" : "·"}
        </div>
        <div>
          <div className="step__label">{stage.label}</div>
          <div className="step__detail">{stage.detail}</div>
        </div>
        <div className="step__state">
          {stage.state === "active"
            ? "running"
            : stage.state === "done"
              ? "done"
              : stage.state === "error"
                ? "failed"
                : "queued"}
        </div>
      </div>
    ))}
  </div>
);
