import { Award, Check, LockKeyhole, Trophy } from "lucide-react";
import { useState } from "react";
import type { WagerSettleResult } from "../domain/types";
import { fmtKm, fmtTnight } from "../lib/format";
import { athleteLabel } from "../lib/identity-label";
import { Button, Notice } from "./bits";

export const RevealSettle = ({ result }: { result: WagerSettleResult }) => {
  const { wager } = result;
  const [showComparison, setShowComparison] = useState(false);
  const settlement = wager.result;
  if (!settlement) return null;

  const winner = settlement.winner ? athleteLabel(settlement.winner) : null;
  const challengerValue = settlement.challengerValue ?? 0;
  const opponentValue = settlement.opponentValue ?? 0;

  return (
    <div className="settlement-reveal">
      <div className="settlement-reveal__mark" aria-hidden="true">
        {settlement.tie ? <Check /> : <Trophy />}
      </div>
      <p className="page-context">Settlement confirmed</p>
      <h2>
        {settlement.tie
          ? "The wager ended in a tie."
          : settlement.forfeit
            ? settlement.summary
            : winner === "You"
              ? "You won the private wager."
              : `${winner ?? "The opposing holder"} won the private wager.`}
      </h2>
      <p className="settlement-pot">
        {fmtTnight(settlement.pot)} {settlement.currency} pot settled
      </p>

      <div className="settlement-identities">
        <div>
          <span>{athleteLabel(wager.challenger)}</span>
          <strong>{showComparison ? fmtKm(challengerValue) : "Sealed"}</strong>
        </div>
        <span aria-hidden="true">versus</span>
        <div>
          <span>{athleteLabel(wager.opponent)}</span>
          <strong>{showComparison ? fmtKm(opponentValue) : "Sealed"}</strong>
        </div>
      </div>

      <div className="settlement-privacy">
        <LockKeyhole aria-hidden="true" />
        <span>
          <strong>No athlete names or wallets were used.</strong>
          {showComparison
            ? " You chose to show the values available after settlement."
            : " The room-safe result reveals only the outcome and pot."}
        </span>
      </div>

      {!showComparison && settlement.disclosed ? (
        <Button tone="ghost" onClick={() => setShowComparison(true)}>
          Show settled comparison
        </Button>
      ) : null}

      {settlement.nft ? (
        <div className="nft-receipt">
          <Award aria-hidden="true" />
          <span>
            <strong>Winner badge received</strong>
            Shielded token {settlement.nft.tokenType.slice(0, 12)}…
          </span>
        </div>
      ) : null}

      <Notice tone="success">
        The contract enforced the wager and moved the pot. Both participants remain pseudonymous.
      </Notice>
    </div>
  );
};
