import { describe, expect, it } from "vitest";
import { credentialFromVaultEntry } from "./state-mappers";

describe("credentialFromVaultEntry", () => {
  it("omits empty ledger metric slots and deduplicates visible claims", () => {
    const credential = credentialFromVaultEntry("0xabc", undefined, 0, [
      { metricId: 1, value: 15_000 },
      { metricId: 2, value: 10_800 },
      { metricId: 0, value: 0 },
      { metricId: 0, value: 0 },
      { metricId: 1, value: 15_000 },
    ]);

    expect(credential.provableChips).toEqual(["distance ≥ 15.0 km", "moving time ≥ 180 min"]);
  });

  it("uses a clean fallback when the ledger exposes only empty slots", () => {
    const credential = credentialFromVaultEntry("0xabc", undefined, 0, [{ metricId: 0, value: 0 }]);

    expect(credential.provableChips).toEqual(["workout attested and sealed"]);
  });
});
