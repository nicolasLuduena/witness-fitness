// Wagers screen affordances: when the wager list is EMPTY (fresh devnet,
// indexer lag after a reload) there must still be a way to manually load
// wagers — the refresh button used to be gated on wagers.length > 0, leaving
// the empty state with no way to reload short of a full page refresh.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Athlete, ClientSession } from "../domain/types";
import { type DemoState, useDemo } from "../state/DemoStore";
import { WagersScreen } from "./WagersScreen";

vi.mock("../state/DemoStore", () => ({
  useDemo: vi.fn(),
}));

const athlete: Athlete = {
  name: "Wallet athlete",
  handle: "local",
  role: "local",
  holderBinding: `0x${"ab".repeat(32)}`,
};

const session: ClientSession = {
  mode: "wallet",
  athlete,
  walletConnected: true,
  walletLabel: "Lace · 0xabcdef",
};

const baseDemo = (overrides: Partial<DemoState> = {}): DemoState =>
  ({
    mode: "wallet",
    client: {} as never,
    session: null,
    connecting: false,
    connectError: null,
    credentials: [],
    wagers: [],
    streak: null,
    badges: [],
    proofs: [],
    notaries: [],
    attestRunning: false,
    attestStages: [],
    attestOutcome: null,
    settleReveal: null,
    connect: vi.fn(async () => {}),
    attest: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    refreshNotaries: vi.fn(async () => {}),
    createWager: vi.fn(async () => ({}) as never),
    acceptWager: vi.fn(async () => {}),
    submitWorkout: vi.fn(async () => {}),
    settleWager: vi.fn(async () => {}),
    clearSettleReveal: vi.fn(),
    advanceStreak: vi.fn(async () => {}),
    mintBadge: vi.fn(async () => {}),
    proveBadge: vi.fn(async () => {}),
    ...overrides,
  }) as DemoState;

describe("WagersScreen empty state", () => {
  it("offers a manual refresh button when there are no wagers", () => {
    vi.mocked(useDemo).mockReturnValue(baseDemo({ session, wagers: [] }));

    const html = renderToStaticMarkup(<WagersScreen />);

    expect(html).toContain("No private wagers yet");
    expect(html).toContain("Refresh wagers");
    expect(html).toContain("Create private wager");
  });

  it("keeps the header refresh action for a connected session with wagers", () => {
    const wager = {
      id: 1,
      title: "Distance duel",
      metric: { id: 1n, label: "distance", unit: "m" },
      stake: 10,
      deadlineBlock: 0n,
      createdAt: 0,
      status: "open",
      challenger: athlete,
      opponent: { ...athlete, role: "opponent", holderBinding: `0x${"cd".repeat(32)}` },
      submissions: [],
    };
    vi.mocked(useDemo).mockReturnValue(baseDemo({ session, wagers: [wager as never] }));

    const html = renderToStaticMarkup(<WagersScreen />);

    expect(html).toContain('aria-label="Refresh wagers"');
    expect(html).toContain("Create private wager");
  });
});
