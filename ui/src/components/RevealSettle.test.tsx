import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ATHLETE_A, ATHLETE_B } from "../domain/story";
import { METRICS, type WagerSettleResult } from "../domain/types";
import { RevealSettle } from "./RevealSettle";

describe("RevealSettle", () => {
  it("presents a no-submission settlement as a refund", () => {
    const result: WagerSettleResult = {
      wager: {
        id: 1,
        title: "Distance duel",
        metric: METRICS[0],
        stake: 1,
        deadlineBlock: 1n,
        createdAt: 0,
        status: "settled",
        challenger: ATHLETE_A,
        opponent: ATHLETE_B,
        submissions: [],
        result: {
          winner: undefined,
          tie: false,
          forfeit: false,
          pot: 2,
          currency: "NIGHT",
          disclosed: false,
          summary: "Neither submitted — both stakes refunded (2 NIGHT pot)",
        },
      },
      reveal: { sealedForRoom: true },
    };

    const html = renderToStaticMarkup(<RevealSettle result={result} />);

    expect(html).toContain("No workouts were submitted. Both stakes were refunded.");
    expect(html).toContain("2 NIGHT returned");
    expect(html.match(/No submission/g)).toHaveLength(2);
    expect(html).not.toContain("won the private wager");
    expect(html).not.toContain(">Sealed<");
    expect(html).not.toContain("moved the pot");
  });
});
