import { Award, Check, LockKeyhole, Trophy } from "lucide-react";
import { useState } from "react";
import type { WagerSettleResult } from "../domain/types";
import { fmtKm, fmtToken } from "../lib/format";
import { athleteLabel } from "../lib/identity-label";
import { Button, Notice } from "./bits";

export const RevealSettle = ({ result }: { result: WagerSettleResult }) => {
  const { wager } = result;
  const [showComparison, setShowComparison] = useState(false);
  const settlement = wager.result;
  if (!settlement) return null;

  const winner = settlement.winner ? athleteLabel(settlement.winner) : null;
  const noSubmissions = wager.submissions.length === 0;
  const challengerSubmitted = wager.submissions.some(
    ({ athlete }) => athlete.holderBinding === wager.challenger.holderBinding,
  );
  const opponentSubmitted = wager.submissions.some(
    ({ athlete }) => athlete.holderBinding === wager.opponent.holderBinding,
  );
  const challengerValue = settlement.challengerValue ?? 0;
  const opponentValue = settlement.opponentValue ?? 0;

  return (
    <div className="settlement-reveal">
      <div className="settlement-reveal__mark" aria-hidden="true">
        {settlement.tie || noSubmissions ? <Check /> : <Trophy />}
      </div>
      <p className="page-context">Settlement confirmed</p>
      <h2>
        {noSubmissions
          ? "No workouts were submitted. Both stakes were refunded."
          : settlement.tie
            ? "The wager ended in a tie."
            : settlement.forfeit
              ? settlement.summary
              : winner === "You"
                ? "You won the private wager."
                : winner
                  ? `${winner} won the private wager.`
                  : "The wager settled under seal."}
      </h2>
      <p className="settlement-pot">
        {fmtToken(settlement.pot, settlement.currency)}{" "}
        {noSubmissions || settlement.tie ? "returned" : "pot settled"}
      </p>

      <div className="settlement-identities">
        <div>
          <span>{athleteLabel(wager.challenger)}</span>
          <strong>
            {challengerSubmitted
              ? showComparison
                ? fmtKm(challengerValue)
                : "Sealed"
              : "No submission"}
          </strong>
        </div>
        <span aria-hidden="true">versus</span>
        <div>
          <span>{athleteLabel(wager.opponent)}</span>
          <strong>
            {opponentSubmitted
              ? showComparison
                ? fmtKm(opponentValue)
                : "Sealed"
              : "No submission"}
          </strong>
        </div>
      </div>

      <div className="settlement-privacy">
        <LockKeyhole aria-hidden="true" />
        <span>
          <strong>No athlete names or wallets were used.</strong>
          {noSubmissions
            ? " The room-safe result reveals only that both stakes were refunded."
            : showComparison
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
        {noSubmissions
          ? "The contract refunded both stakes. Both participants remain pseudonymous."
          : settlement.tie
            ? "The contract refunded both stakes after the tie. Both participants remain pseudonymous."
            : "The contract enforced the wager and moved the pot. Both participants remain pseudonymous."}
      </Notice>
    </div>
  );
};
