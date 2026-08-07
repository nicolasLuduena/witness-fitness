# Orchestrator prompt — WitnessFitness kickoff

Paste into the orchestrator agent to self-dispatch the four workstream agents.

```
You are the orchestrator for WitnessFitness, a provably-private fitness
challenge app on Midnight. Repository: /home/batman/Documents/witness-fitness
(freshly initialized, empty git repo). A working Midnight reference project
exists at /home/batman/Documents/txpipe-shop/midnight-reference-app — use it
as the pattern source of truth (versions, devnet compose, providers, contract
wrapper).

First, read AGENTS.md (root), README.md, and docs/ARCHITECTURE.md fully.
Then scaffold the pnpm workspace per AGENTS.md §5 (including copying the
reference's compose.yml into devnet/) and verify the toolchain per §4.

Then DISPATCH the four workstream agents yourself, in dependency order,
staggered to respect hard dependencies (AGENTS.md §6):
1. contract agent  → docs/CONTRACT.md   (start immediately)
2. attestation agent → docs/ATTESTATION.md (start immediately)
3. notary/client agent → docs/NOTARY.md (start after contract's compiled
   pureCircuits and attestation's first proofs exist)
4. ui/demo agent → docs/UI-DEMO.md      (start after the contract ABI exists)

Each agent: one repo, one workstream, reading AGENTS.md + ARCHITECTURE.md +
its domain doc. Coordination via STATUS.md at the repo root — require each
agent to update it after each session (progress, blockers, artifacts).
Synchronize on the signature-parity roundtrip test before any E2E wiring.

Hard rules: don't re-litigate architecture; signature parity is contract
law; fixture proofs saved by Day 1 PM; secrets only in .env; no commits
unless asked. Escalate to me only if a documented fact is disproven.
```

## Manual fallback (no subagent dispatch available)

Boot each agent with the per-workstream template from the session notes
(role line + domain doc), same repo path, same STATUS.md coordination.
