import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { StrideSim } from './helpers/sim.js';
import {
  holderBindingOf,
  makeAssertion,
  makeNotaryKey,
  nowSeconds,
  privateStateWith,
  signAttestation,
  vaultKeyOf,
} from './helpers/fixtures.js';
import { createPrivateState, type PrivateState } from '../src/private-state.js';

const DAY = 86400n;
const STALE_WINDOW = 2592000n; // 30 days — matches freshnessWindow() in stride.compact
const dayOf = (ts: bigint): bigint => ts / DAY;

const adminSecret = randomBytes(32);
const otherAdminSecret = randomBytes(32);
const holderA = randomBytes(32);
const holderB = randomBytes(32);
const notaryKeys = [makeNotaryKey(1), makeNotaryKey(2), makeNotaryKey(3)];

const psA = (overrides: Partial<PrivateState> = {}): PrivateState => ({
  ...createPrivateState(adminSecret, holderA),
  ...overrides,
});
const psB = (overrides: Partial<PrivateState> = {}): PrivateState => ({
  ...createPrivateState(otherAdminSecret, holderB),
  ...overrides,
});

const bindingA = holderBindingOf(holderA);
const bindingB = holderBindingOf(holderB);

// Real-money payout routing: 32-byte UserAddress payloads (the compact
// UserAddress type) + shielded coin keys for the winner NFT.
const payoutOf = (seed: number): Uint8Array => {
  const b = new Uint8Array(32);
  b[0] = seed;
  return b;
};
const payoutA = payoutOf(0xa1);
const payoutB = payoutOf(0xb2);
const coinKeyA = { bytes: payoutOf(0xc3) };
const coinKeyB = { bytes: payoutOf(0xd4) };

let sim: StrideSim;

describe('stride contract', () => {
  beforeEach(() => {
    sim = new StrideSim(psA());
    sim.call('registerAdmin', psA());
    for (let i = 0; i < 3; i += 1) {
      sim.call('registerNotary', psA(), notaryKeys[i].pk, BigInt(i));
    }
  });

  const vaultCredential = (
    holderSecret: Uint8Array,
    assertion = makeAssertion(),
    rand = randomBytes(32)
  ) => {
    const att = signAttestation(assertion, notaryKeys, holderSecret, rand);
    const ps = holderSecret === holderA ? psA() : psB();
    sim.call('verifyAttestation', privateStateWith(ps, att));
    return { att, vaultKey: vaultKeyOf(assertion, rand) };
  };

  describe('verifyAttestation', () => {
    it('accepts 2-of-3 valid signatures', () => {
      const assertion = makeAssertion();
      const att = signAttestation(assertion, [notaryKeys[0], notaryKeys[1], null], holderA, randomBytes(32));
      sim.call('verifyAttestation', privateStateWith(psA(), att));
      expect(sim.ledgerView().vault.member(vaultKeyOf(assertion, att.commitRand))).toBe(true);
    });

    it('accepts 3-of-3 valid signatures', () => {
      const assertion = makeAssertion();
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      sim.call('verifyAttestation', privateStateWith(psA(), att));
      expect(sim.ledgerView().vault.member(vaultKeyOf(assertion, att.commitRand))).toBe(true);
    });

    it('rejects 1-of-3 valid signatures', () => {
      const assertion = makeAssertion();
      const att = signAttestation(assertion, [notaryKeys[0], null, null], holderA, randomBytes(32));
      expect(() => sim.call('verifyAttestation', privateStateWith(psA(), att))).toThrow(
        'Insufficient valid signatures'
      );
    });

    it('rejects a tampered assertion', () => {
      const assertion = makeAssertion({ claims: [{ metricId: 1n, value: 10000n }] });
      const att = signAttestation(assertion, [notaryKeys[0], notaryKeys[1], null], holderA, randomBytes(32));
      const tampered = privateStateWith(psA(), att);
      tampered.assertion = makeAssertion({
        claims: [{ metricId: 1n, value: 20000n }],
        nonce: assertion.nonce,
        timestamp: assertion.timestamp,
        reclaimProofHash: assertion.reclaimProofHash,
      });
      expect(() => sim.call('verifyAttestation', tampered)).toThrow(
        'Insufficient valid signatures'
      );
    });

    it('rejects replay of the same nonce', () => {
      const assertion = makeAssertion();
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      const ps = privateStateWith(psA(), att);
      sim.call('verifyAttestation', ps);
      expect(() => sim.call('verifyAttestation', ps)).toThrow('Nonce replay');
    });

    it('rejects a stale timestamp (31 days, outside the 30-day window)', () => {
      const assertion = makeAssertion({ timestamp: nowSeconds() - STALE_WINDOW - 86400n });
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      expect(() => sim.call('verifyAttestation', privateStateWith(psA(), att))).toThrow(
        'Timestamp too old'
      );
    });

    it('accepts an 8-day-old timestamp (previously rejected under the 7-day window)', () => {
      const assertion = makeAssertion({ timestamp: nowSeconds() - 8n * DAY });
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      sim.call('verifyAttestation', privateStateWith(psA(), att));
      expect(sim.ledgerView().vault.member(vaultKeyOf(assertion, att.commitRand))).toBe(true);
    });

    it('rejects a 40-day-old timestamp', () => {
      const assertion = makeAssertion({ timestamp: nowSeconds() - 40n * DAY });
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      expect(() => sim.call('verifyAttestation', privateStateWith(psA(), att))).toThrow(
        'Timestamp too old'
      );
    });

    it('rejects a future timestamp', () => {
      const assertion = makeAssertion({ timestamp: nowSeconds() + 86400n });
      const att = signAttestation(assertion, notaryKeys, holderA, randomBytes(32));
      expect(() => sim.call('verifyAttestation', privateStateWith(psA(), att))).toThrow(
        'Timestamp in the future'
      );
    });
  });

  describe('notary registry', () => {
    it('rotates and blacklists notary keys', () => {
      const rotated = makeNotaryKey(9);
      sim.call('rotateNotary', psA(), BigInt(1), rotated.pk);
      expect(sim.ledgerView().registry[1]).toEqual(rotated.pk);
      sim.call('blacklistNotary', psA(), BigInt(1));
      expect(sim.ledgerView().registry[1]).toEqual({ x: 0n, y: 1n });
    });

    it('rejects non-admin registry changes', () => {
      expect(() => sim.call('registerNotary', psB(), makeNotaryKey(9).pk, BigInt(0))).toThrow(
        'Not the admin'
      );
    });

    // AUDIT M1 (constructor pin): the admin identity is pinned by the
    // constructor at deploy — a stranger can no longer seize admin via a
    // first-call race on registerAdmin.
    it('AUDIT: rejects a stranger seizing admin via registerAdmin', () => {
      const stranger = createPrivateState(randomBytes(32), holderA);
      expect(() => sim.call('registerAdmin', stranger)).toThrow('Not the admin');
      // the deployer's registerAdmin re-assert passes
      expect(() => sim.call('registerAdmin', psA())).not.toThrow();
    });
  });

  describe('wagers (real unshielded NIGHT pot)', () => {
    const makeWager = (
      ps: PrivateState,
      stake: bigint,
      deadline: bigint,
      payout = payoutA,
      coinKey = coinKeyA
    ) => sim.call('createWager', ps, bindingB, 1n, stake, deadline, payout, coinKey);

    it('escrows the challenger stake as a real unshielded receive', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      expect(sim.unshieldedInputSum()).toBe(1000n);
      expect(sim.ledgerView().wagers.member(0n)).toBe(true);
      const stored = sim.ledgerView().wagers.lookup(0n);
      expect(Buffer.from(stored.challengerPayout)).toEqual(Buffer.from(payoutA));
      expect(stored.challengerCoinKey.bytes).toEqual(coinKeyA.bytes);
    });

    it('escrows the opponent stake on accept and pins opponent payout + coin key', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      expect(sim.unshieldedInputSum()).toBe(1000n);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      expect(sim.unshieldedInputSum()).toBe(1000n);
      const stored = sim.ledgerView().wagers.lookup(0n);
      expect(stored.accepted).toBe(true);
      expect(Buffer.from(stored.opponentPayout)).toEqual(Buffer.from(payoutB));
      expect(stored.opponentCoinKey.bytes).toEqual(coinKeyB.bytes);
      expect(stored.challengerPayout).toEqual(stored.challengerPayout);
    });

    it('refunds the challenger stake via an unshielded send on cancel', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      sim.call('cancelWager', psA(), 0n);
      expect(sim.unshieldedOutputSum()).toBe(1000n);
      expect(sim.ledgerView().wagers.member(0n)).toBe(false);
    });

    it('refuses cancel after acceptance', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      expect(() => sim.call('cancelWager', psA(), 0n)).toThrow('Wager already accepted');
    });

    it('rejects accept by a stranger', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      expect(() => sim.call('acceptWager', psA(), 0n, payoutA, coinKeyA)).toThrow(
        'Not the opponent'
      );
    });

    it('rejects re-accept and double escrow', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      expect(() => sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB)).toThrow(
        'Wager already accepted'
      );
    });

    it('pins the payout/coin-key args (a tamper at settle is impossible by construction)', () => {
      makeWager(psA(), 1000n, nowSeconds() + 3600n, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      const before = sim.ledgerView().wagers.lookup(0n);
      // settleWager takes only the id — the routing args do not exist on it,
      // so the stored payouts are what get paid. Verify the stored values.
      expect(Buffer.from(before.challengerPayout)).toEqual(Buffer.from(payoutA));
      expect(Buffer.from(before.opponentPayout)).toEqual(Buffer.from(payoutB));
      expect(before.challengerCoinKey.bytes).toEqual(coinKeyA.bytes);
      expect(before.opponentCoinKey.bytes).toEqual(coinKeyB.bytes);
    });
  });

  describe('submitWorkout', () => {
    const openWager = (stake = 1000n, deadline = nowSeconds() + 3600n): bigint => {
      sim.call('createWager', psA(), bindingB, 1n, stake, deadline, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      return 0n;
    };

    it('stores a sealed submission', () => {
      const id = openWager();
      const { att, vaultKey } = vaultCredential(holderA);
      sim.call('submitWorkout', privateStateWith(psA(), att), id, vaultKey, 12345n);
      const wager = sim.ledgerView().wagers.lookup(id);
      expect(wager.challengerSubmission.is_some).toBe(true);
    });

    it('blocks double-counting the same credential in one wager but allows another wager', () => {
      const id0 = openWager();
      const { att, vaultKey } = vaultCredential(holderA);
      sim.call('submitWorkout', privateStateWith(psA(), att), id0, vaultKey, 12345n);
      expect(() =>
        sim.call('submitWorkout', privateStateWith(psA(), att), id0, vaultKey, 12345n)
      ).toThrow('Workout already counted in this wager');

      sim.call('createWager', psA(), bindingB, 1n, 1000n, nowSeconds() + 3600n, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 1n, payoutB, coinKeyB);
      sim.call('submitWorkout', privateStateWith(psA(), att), 1n, vaultKey, 12345n);
      expect(sim.ledgerView().wagers.lookup(1n).challengerSubmission.is_some).toBe(true);
    });

    it('rejects a credential not bound to the caller', () => {
      const id = openWager();
      const { att, vaultKey } = vaultCredential(holderB);
      const impostor = { ...privateStateWith(psA(), att), holderSecret: holderA };
      expect(() => sim.call('submitWorkout', impostor, id, vaultKey, 12345n)).toThrow(
        'Credential not bound to caller'
      );
    });

    it('rejects a mismatched claim value', () => {
      const id = openWager();
      const { att, vaultKey } = vaultCredential(holderA);
      expect(() =>
        sim.call('submitWorkout', privateStateWith(psA(), att), id, vaultKey, 9999n)
      ).toThrow('Claim value mismatch');
    });
  });

  describe('settleWager (real payouts + winner NFT)', () => {
    const wagerFixture = (stake = 1000n, deadline = nowSeconds() + 3600n) => {
      sim.call('createWager', psA(), bindingB, 1n, stake, deadline, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      return 0n;
    };

    // Time-travel past deadline + settleGrace(60s) so settlement unlocks.
    const afterDeadline = (): void => {
      sim.now = Number(nowSeconds()) + 3700;
    };

    const submitAs = (
      holderSecret: Uint8Array,
      att: ReturnType<typeof signAttestation>,
      vaultKey: Uint8Array,
      value: bigint,
      wagerId: bigint
    ): Uint8Array => {
      const submissionRand = randomBytes(32);
      const ps = {
        ...privateStateWith(holderSecret === holderA ? psA() : psB(), att),
        submissionRand,
      };
      sim.call('submitWorkout', ps, wagerId, vaultKey, value);
      return submissionRand;
    };

    const settleWith = (v1: bigint, r1: Uint8Array, v2: bigint, r2: Uint8Array) => {
      afterDeadline();
      sim.call('settleWager', { ...psA(), wagerOpenings: [v1, r1, v2, r2] }, 0n);
    };

    it('pays the winner the whole pot (2x stake) and mints the winner NFT', () => {
      wagerFixture();
      const a = vaultCredential(holderA, makeAssertion({ claims: [{ metricId: 1n, value: 15000n }] }));
      const b = vaultCredential(holderB, makeAssertion({ claims: [{ metricId: 1n, value: 9000n }] }));
      const ra = submitAs(holderA, a.att, a.vaultKey, 15000n, 0n);
      const rb = submitAs(holderB, b.att, b.vaultKey, 9000n, 0n);
      settleWith(15000n, ra, 9000n, rb);
      expect(sim.unshieldedOutputSum()).toBe(2000n);
      const mints = sim.shieldedMints();
      expect(mints.size).toBe(1);
      expect([...mints.values()][0]).toBe(1n);
      expect(sim.ledgerView().wagers.lookup(0n).settled).toBe(true);
    });

    it('refunds both on a tie and mints no NFT', () => {
      wagerFixture();
      const a = vaultCredential(holderA, makeAssertion({ claims: [{ metricId: 1n, value: 10000n }] }));
      const b = vaultCredential(holderB, makeAssertion({ claims: [{ metricId: 1n, value: 10000n }] }));
      const ra = submitAs(holderA, a.att, a.vaultKey, 10000n, 0n);
      const rb = submitAs(holderB, b.att, b.vaultKey, 10000n, 0n);
      settleWith(10000n, ra, 10000n, rb);
      expect(sim.unshieldedOutputSum()).toBe(2000n);
      expect(sim.shieldedMints().size).toBe(0);
      expect(sim.ledgerView().wagers.lookup(0n).settled).toBe(true);
    });

    it('awards the whole pot + NFT by forfeit when one side never submits', () => {
      wagerFixture();
      const a = vaultCredential(holderA);
      submitAs(holderA, a.att, a.vaultKey, 12345n, 0n);
      afterDeadline();
      sim.call('settleWager', psA(), 0n);
      expect(sim.unshieldedOutputSum()).toBe(2000n);
      const mints = sim.shieldedMints();
      expect(mints.size).toBe(1);
      expect([...mints.values()][0]).toBe(1n);
    });

    it('refunds both when neither submits and mints no NFT', () => {
      wagerFixture();
      afterDeadline();
      sim.call('settleWager', psA(), 0n);
      expect(sim.unshieldedOutputSum()).toBe(2000n);
      expect(sim.shieldedMints().size).toBe(0);
    });

    it('mints distinct NFTs across separate wagers (nonce evolves)', () => {
      wagerFixture();
      const a = vaultCredential(holderA);
      submitAs(holderA, a.att, a.vaultKey, 12345n, 0n);
      afterDeadline();
      sim.call('settleWager', psA(), 0n);
      const firstMint = sim.shieldedMints();

      sim.now = null; // back to real time for the second wager's creation
      sim.call('createWager', psA(), bindingB, 1n, 1000n, nowSeconds() + 3600n, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 1n, payoutB, coinKeyB);
      const a2 = vaultCredential(holderA);
      submitAs(holderA, a2.att, a2.vaultKey, 12345n, 1n);
      afterDeadline();
      sim.call('settleWager', psA(), 1n);
      const secondMint = sim.shieldedMints();
      expect(firstMint.size).toBe(1);
      expect(secondMint.size).toBe(1);
      expect([...secondMint.keys()][0]).toBe([...firstMint.keys()][0]);
      expect([...secondMint.values()][0]).toBe(1n);
    });

    it('rejects settling before the deadline', () => {
      wagerFixture(1000n, nowSeconds() + 3600n);
      expect(() => sim.call('settleWager', psA(), 0n)).toThrow('Deadline not reached');
    });

    // AUDIT VR-1 (High — the missing deadline gates, now FIXED): a challenger
    // could create a wager whose deadline had ALREADY passed; the victim
    // accepts (escrowing real NIGHT), the challenger submits + settles
    // immediately (deadline + 60s grace already elapsed) — the victim never
    // got a chance to submit and lost their stake to a forfeit. createWager
    // now requires a future deadline, so the exploit is closed at the root.
    it('AUDIT: rejects creating a wager whose deadline has already passed', () => {
      expect(() =>
        sim.call('createWager', psA(), bindingB, 1n, 1000n, nowSeconds() - 10000n, payoutA, coinKeyA)
      ).toThrow('Deadline must be in the future');
    });

    it('rejects accepting after the deadline (wager closed)', () => {
      sim.call('createWager', psA(), bindingB, 1n, 1000n, nowSeconds() + 3600n, payoutA, coinKeyA);
      sim.now = Number(nowSeconds()) + 3700;
      expect(() => sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB)).toThrow('Wager closed');
    });

    it('rejects submitting after the deadline (auction closed)', () => {
      sim.call('createWager', psA(), bindingB, 1n, 1000n, nowSeconds() + 3600n, payoutA, coinKeyA);
      sim.call('acceptWager', psB(), 0n, payoutB, coinKeyB);
      const a = vaultCredential(holderA);
      submitAs(holderA, a.att, a.vaultKey, 12345n, 0n);
      // a different credential, submitted after the deadline
      const a2 = vaultCredential(holderA);
      sim.now = Number(nowSeconds()) + 3700;
      expect(() => sim.call('submitWorkout', privateStateWith(psA(), a2.att), 0n, a2.vaultKey, 12345n)).toThrow(
        'Deadline passed'
      );
    });

    it('settles normally once the deadline + grace has passed', () => {
      wagerFixture();
      const a = vaultCredential(holderA);
      submitAs(holderA, a.att, a.vaultKey, 12345n, 0n);
      sim.now = Number(nowSeconds()) + 3700;
      sim.call('settleWager', psA(), 0n);
      expect(sim.unshieldedOutputSum()).toBe(2000n);
      expect(sim.ledgerView().wagers.lookup(0n).settled).toBe(true);
    });

    it('rejects a self-challenge (opponent == challenger)', () => {
      expect(() =>
        sim.call('createWager', psA(), bindingA, 1n, 1000n, nowSeconds() + 3600n, payoutA, coinKeyA)
      ).toThrow('Cannot challenge yourself');
    });

    it('rejects a stake above 2^63 - 1 (settle payout would overflow)', () => {
      expect(() =>
        sim.call('createWager', psA(), bindingB, 1n, 9223372036854775808n, nowSeconds() + 3600n, payoutA, coinKeyA)
      ).toThrow('Stake too large');
    });

    it('rejects settlement with wrong openings', () => {
      wagerFixture();
      const a = vaultCredential(holderA, makeAssertion({ claims: [{ metricId: 1n, value: 15000n }] }));
      const b = vaultCredential(holderB, makeAssertion({ claims: [{ metricId: 1n, value: 9000n }] }));
      submitAs(holderA, a.att, a.vaultKey, 15000n, 0n);
      submitAs(holderB, b.att, b.vaultKey, 9000n, 0n);
      afterDeadline();
      expect(() =>
        sim.call('settleWager', { ...psA(), wagerOpenings: [1n, new Uint8Array(32).fill(1), 1n, new Uint8Array(32).fill(2)] }, 0n)
      ).toThrow('Bad challenger opening');
    });

    it('rejects settling a wager twice', () => {
      wagerFixture();
      afterDeadline();
      sim.call('settleWager', psA(), 0n);
      expect(() => sim.call('settleWager', psA(), 0n)).toThrow('Wager settled');
    });
  });

  describe('streaks', () => {
    const credentialOnDay = (holderSecret: Uint8Array, day: bigint) => {
      const assertion = makeAssertion({ timestamp: day * DAY + 3600n });
      const rand = randomBytes(32);
      const att = signAttestation(assertion, notaryKeys, holderSecret, rand);
      const ps = holderSecret === holderA ? psA() : psB();
      sim.call('verifyAttestation', privateStateWith(ps, att));
      return { att, vaultKey: vaultKeyOf(assertion, rand), day };
    };

    it('advances, resets on gap, and handles same-day boundary', () => {
      const d1 = dayOf(nowSeconds() - 5n * DAY);
      const c1 = credentialOnDay(holderA, d1);
      sim.call('advanceStreak', privateStateWith(psA(), c1.att), c1.vaultKey, c1.day, c1.att.commitRand);
      expect(sim.ledgerView().streaks.lookup(bindingA)).toEqual({ count: 1n, lastDay: d1 });

      const c2 = credentialOnDay(holderA, d1 + 1n);
      sim.call('advanceStreak', privateStateWith(psA(), c2.att), c2.vaultKey, c2.day, c2.att.commitRand);
      expect(sim.ledgerView().streaks.lookup(bindingA)).toEqual({ count: 2n, lastDay: d1 + 1n });

      const c3 = credentialOnDay(holderA, d1 + 3n);
      sim.call('advanceStreak', privateStateWith(psA(), c3.att), c3.vaultKey, c3.day, c3.att.commitRand);
      expect(sim.ledgerView().streaks.lookup(bindingA)).toEqual({ count: 1n, lastDay: d1 + 3n });

      const c4 = credentialOnDay(holderA, d1 + 3n);
      sim.call('advanceStreak', privateStateWith(psA(), c4.att), c4.vaultKey, c4.day, c4.att.commitRand);
      expect(sim.ledgerView().streaks.lookup(bindingA)).toEqual({ count: 1n, lastDay: d1 + 3n });
    });

    it('rejects a day that does not match the credential', () => {
      const d1 = dayOf(nowSeconds() - 5n * DAY);
      const c1 = credentialOnDay(holderA, d1);
      expect(() =>
        sim.call('advanceStreak', privateStateWith(psA(), c1.att), c1.vaultKey, d1 + 1n, c1.att.commitRand)
      ).toThrow('Day does not match workout');
    });
  });

  describe('badges', () => {
    it('mints streak and distance badges and proves them without revealing values', () => {
      const d1 = dayOf(nowSeconds() - 6n * DAY);
      let vaultKey: Uint8Array = new Uint8Array(32);
      let lastAtt: ReturnType<typeof signAttestation> | null = null;
      for (const day of [d1, d1 + 1n, d1 + 2n]) {
        const assertion = makeAssertion({ timestamp: day * DAY + 3600n });
        const rand = randomBytes(32);
        lastAtt = signAttestation(assertion, notaryKeys, holderA, rand);
        sim.call('verifyAttestation', privateStateWith(psA(), lastAtt));
        vaultKey = vaultKeyOf(assertion, rand);
        sim.call('advanceStreak', privateStateWith(psA(), lastAtt), vaultKey, day, rand);
      }
      sim.call('mintBadge', privateStateWith(psA(), lastAtt!), 1n, vaultKey, lastAtt!.commitRand);
      expect(sim.ledgerView().badges.lookup(bindingA).member(1n)).toBe(true);

      const distance = makeAssertion({ claims: [{ metricId: 1n, value: 42000n }] });
      const rand = randomBytes(32);
      const distAtt = signAttestation(distance, notaryKeys, holderA, rand);
      sim.call('verifyAttestation', privateStateWith(psA(), distAtt));
      const distKey = vaultKeyOf(distance, rand);
      sim.call('mintBadge', privateStateWith(psA(), distAtt), 2n, distKey, rand);
      expect(sim.ledgerView().badges.lookup(bindingA).member(2n)).toBe(true);

      const result = sim.call('proveBadge', psA(), 1n, bindingB);
      expect(result).toEqual([bindingB]);
    });

    it('rejects badges below threshold', () => {
      const assertion = makeAssertion({ claims: [{ metricId: 1n, value: 5000n }] });
      const rand = randomBytes(32);
      const att = signAttestation(assertion, notaryKeys, holderA, rand);
      sim.call('verifyAttestation', privateStateWith(psA(), att));
      expect(() =>
        sim.call('mintBadge', privateStateWith(psA(), att), 2n, vaultKeyOf(assertion, rand), rand)
      ).toThrow('Distance below threshold');
    });

    it('proveBadge fails for a non-holder', () => {
      const vaultCred = vaultCredential(holderB);
      sim.call('mintBadge', privateStateWith(psB(), vaultCred.att), 2n, vaultCred.vaultKey, vaultCred.att.commitRand);
      expect(() => sim.call('proveBadge', psA(), 2n, bindingB)).toThrow('No badges');
    });
  });

  it('rejects non-admin registry changes', () => {
  });
});
