import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { ledger } from "@witnessfitness/contract";

const address =
  process.env.CONTRACT_ADDRESS ??
  "cf80ad421b2b85f6ca1b3c0ccfd140ae5f6fc0d5871426d7750df4d42944cbaf";
const INDEXER = "http://127.0.0.1:8088/api/v3/graphql";
const INDEXER_WS = "ws://127.0.0.1:8088/api/v3/graphql/ws";

const provider = indexerPublicDataProvider(INDEXER, INDEXER_WS);
const state = await provider.queryContractState(address);
if (!state) {
  console.error("no state");
  process.exit(1);
}
const ledgerState = ledger(state.data);
console.log("registry:");
ledgerState.registry.forEach((pk, i) => {
  console.log(`  slot ${i}: x=0x${pk.x.toString(16)} y=0x${pk.y.toString(16)}`);
});
console.log("adminSecret set:", ledgerState.adminSecret !== 0n);
console.log("vault size:", ledgerState.vault.size());
console.log("nullifiers size:", ledgerState.nullifiers.size());
console.log(
  "wagers:",
  ledgerState.wagers.isEmpty() ? "[]" : [...ledgerState.wagers].map(([id]) => id),
);
process.exit(0);
