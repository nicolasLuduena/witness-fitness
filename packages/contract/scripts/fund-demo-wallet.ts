// Fund the demo wallet (derived from a BIP-39 mnemonic) from the devnet
// genesis-mint wallet: unshielded NIGHT + shielded NIGHT + NIGHT registered
// for dust generation so the demo wallet can pay transaction fees.
//   pnpm --filter @witnessfitness/contract exec tsx scripts/fund-demo-wallet.ts
// Requires devnet: node 9944, indexer 8088, proof server 6300.
// Idempotent: skips the transfer when the target already holds unshielded NIGHT.

import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { getNetworkId, setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { CombinedTokenTransfer } from "@midnight-ntwrk/wallet-sdk-facade";
import { ShieldedAddress, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { firstValueFrom, filter, map, timeout } from "rxjs";
import { buildWallet, constructWallet, registerForDustGeneration } from "../src/wallet.js";

const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8088/api/v3/graphql";
const INDEXER_WS = process.env.INDEXER_WS_URL ?? "ws://127.0.0.1:8088/api/v3/graphql/ws";
const NODE = process.env.NODE_URL ?? "http://127.0.0.1:9944";
const PROOF_SERVER = process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300";
const GENESIS_MINT_WALLET_SEED =
  process.env.GENESIS_MINT_WALLET_SEED ??
  "0000000000000000000000000000000000000000000000000000000000000001";
const DEMO_MNEMONIC =
  process.env.WF_DEMO_MNEMONIC ??
  "student draft decorate organ thought better argue meadow trust number humble wagon animal turkey learn tool marine december soft spoil country salt injury float";
// Demo-unit convention (matches the sidecar's stakeNight): 1 NIGHT = 10^12 units.
const DEMO_UNSHIELDED_AMOUNT = BigInt(process.env.WF_DEMO_UNSHIELDED_AMOUNT ?? 100) * 10n ** 12n;
const DEMO_SHIELDED_AMOUNT = BigInt(process.env.WF_DEMO_SHIELDED_AMOUNT ?? 50) * 10n ** 12n;
const BALANCE_TIMEOUT_MS = Number(process.env.WF_DEMO_BALANCE_TIMEOUT_MS ?? 120_000);

const config = { indexer: INDEXER, indexerWS: INDEXER_WS, node: NODE, proofServer: PROOF_SERVER };
const NIGHT_UNSHIELDED = ledger.unshieldedToken().raw;
const NIGHT_SHIELDED = ledger.shieldedToken().raw;

const log = (message: string): void => console.log(`[fund-demo-wallet] ${message}`);

const waitForBalances = (
  ctx: ReturnType<typeof constructWallet> extends Promise<infer T> ? T : never,
  unshieldedAmount: bigint,
  shieldedAmount: bigint,
): Promise<void> =>
  firstValueFrom(
    ctx.wallet.state().pipe(
      filter((s) => s.isSynced),
      map((s) => {
        const unshielded = s.unshielded.balances[NIGHT_UNSHIELDED] ?? 0n;
        const shielded = s.shielded.balances[NIGHT_SHIELDED] ?? 0n;
        return { unshielded, shielded };
      }),
      filter(({ unshielded, shielded }) => unshielded >= unshieldedAmount && shielded >= shieldedAmount),
      timeout({ first: BALANCE_TIMEOUT_MS }),
      map(() => undefined),
    ),
  );

const main = async () => {
  setNetworkId(config.networkId ?? "undeployed");
  const networkId = getNetworkId();
  if (!validateMnemonic(DEMO_MNEMONIC, wordlist)) {
    log(
      "WARNING: WF_DEMO_MNEMONIC fails the BIP-39 checksum — the seed is still derived " +
        "deterministically (PBKDF2 of the phrase), but standard wallets will reject it. " +
        "Use a real mnemonic for any wallet that must be restored elsewhere.",
    );
  }
  const targetSeed = Buffer.from(mnemonicToSeedSync(DEMO_MNEMONIC)).toString("hex");
  log("building target wallet from mnemonic...");
  const target = await constructWallet(config, targetSeed);
  const targetState = await firstValueFrom(target.wallet.state().pipe(filter((s) => s.isSynced)));
  const targetUnshieldedBech32m = UnshieldedAddress.codec.encode(
    networkId,
    targetState.unshielded.address,
  );
  const targetUnshieldedBech32 = targetUnshieldedBech32m.asString();
  const targetShieldedBech32m = ShieldedAddress.codec.encode(networkId, targetState.shielded.address);
  const targetShieldedBech32 = targetShieldedBech32m.asString();
  const targetUnshieldedHex = UnshieldedAddress.codec.decode(networkId, targetUnshieldedBech32m)
    .hexString;
  log(`target unshielded address: ${targetUnshieldedBech32}`);
  log(`target shielded address:   ${targetShieldedBech32}`);

  const currentUnshielded = targetState.unshielded.balances[NIGHT_UNSHIELDED] ?? 0n;
  const currentShielded = targetState.shielded.balances[NIGHT_SHIELDED] ?? 0n;
  log(
    `target balances: unshielded ${currentUnshielded} (${Number(currentUnshielded) / 1e12} NIGHT), ` +
      `shielded ${currentShielded} (${Number(currentShielded) / 1e12} NIGHT)`,
  );

  if (currentUnshielded >= DEMO_UNSHIELDED_AMOUNT && currentShielded >= DEMO_SHIELDED_AMOUNT) {
    log("target already funded — skipping transfer");
  } else {
    log("building genesis sender wallet...");
    const genesis = await buildWallet(config, GENESIS_MINT_WALLET_SEED);
    await registerForDustGeneration(genesis.wallet, genesis.unshieldedKeystore);
    const genesisState = await firstValueFrom(genesis.wallet.state().pipe(filter((s) => s.isSynced)));
    const genesisUnshielded = genesisState.unshielded.balances[NIGHT_UNSHIELDED] ?? 0n;
    const genesisShielded = genesisState.shielded.balances[NIGHT_SHIELDED] ?? 0n;
    if (genesisUnshielded < DEMO_UNSHIELDED_AMOUNT || genesisShielded < DEMO_SHIELDED_AMOUNT) {
      throw new Error(
        `genesis wallet is short: unshielded ${genesisUnshielded}, shielded ${genesisShielded} ` +
          `(need ${DEMO_UNSHIELDED_AMOUNT} / ${DEMO_SHIELDED_AMOUNT})`,
      );
    }

    const outputs: CombinedTokenTransfer[] = [
      {
        type: "unshielded",
        outputs: [
          {
            type: NIGHT_UNSHIELDED,
            receiverAddress: targetState.unshielded.address,
            amount: DEMO_UNSHIELDED_AMOUNT,
          },
        ],
      },
      {
        type: "shielded",
        outputs: [
          {
            type: NIGHT_SHIELDED,
            receiverAddress: targetState.shielded.address,
            amount: DEMO_SHIELDED_AMOUNT,
          },
        ],
      },
    ];

    log(
      `transferring ${DEMO_UNSHIELDED_AMOUNT} unshielded + ${DEMO_SHIELDED_AMOUNT} shielded NIGHT ` +
        `to the target wallet...`,
    );
    const recipe = await genesis.wallet.transferTransaction(
      outputs,
      { shieldedSecretKeys: genesis.shieldedSecretKeys, dustSecretKey: genesis.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    const signed = await genesis.wallet.signRecipe(recipe, (payload) =>
      genesis.unshieldedKeystore.signData(payload),
    );
    const finalized = await genesis.wallet.finalizeRecipe(signed);
    const txId = await genesis.wallet.submitTransaction(finalized);
    log(`transfer submitted: ${txId}`);

    log("waiting for the target wallet to see the funds...");
    await waitForBalances(target, DEMO_UNSHIELDED_AMOUNT, DEMO_SHIELDED_AMOUNT);
  }

  log("registering the target wallet's NIGHT for dust generation...");
  await registerForDustGeneration(target.wallet, target.unshieldedKeystore);
  const finalState = await firstValueFrom(target.wallet.state().pipe(filter((s) => s.isSynced)));
  const dustBalance = finalState.dust.balance(new Date());
  log(
    `DONE — unshielded ${finalState.unshielded.balances[NIGHT_UNSHIELDED] ?? 0n} units, ` +
      `shielded ${finalState.shielded.balances[NIGHT_SHIELDED] ?? 0n} units, ` +
      `DUST ${dustBalance}`,
  );
  log(`wager payout routing — unshielded hex: ${targetUnshieldedHex}`);
  log(`wager NFT receipt — coin key: 0x${targetState.shielded.coinPublicKey.toHexString()}`);
  log(
    `wager NFT receipt — encryption key: 0x${targetState.shielded.encryptionPublicKey.toHexString()}`,
  );
};

// The built wallets hold open node/indexer WebSocket connections — without an
// explicit exit the process hangs after the summary.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[fund-demo-wallet] FAILED:", error);
    process.exitCode = 1;
  });
