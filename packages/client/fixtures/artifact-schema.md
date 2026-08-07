# artifact-schema.md — Reclaim proof artifact schema (for the notary agent)

Owner: attestation workstream. This is the **doc of record** for the shape of
proof artifacts the notary signer must parse and verify. Live-updated as real
proofs are generated.

## 1. Build-start verification #1 — attestor `PRIVATE_KEY` signature scheme

**Finding: the attestor's `PRIVATE_KEY` is an Ethereum (secp256k1 ECDSA) private
key — hex, `0x`-prefixed, 32 bytes. Nothing else is supported.**

Evidence (attestor-core source, commit cloned 2026-08-06, package v5.0.8):

- `.env.sample`: *"ETH private key. This could be the private key of some other
  signature algorithm too. However, at the moment -- only ETH is supported."*
- `src/utils/signatures/index.ts`: the only registered provider is
  `SERVICE_SIGNATURE_TYPE_ETH`; `SelectedServiceSignatureType` is hard-set to it.
- `src/utils/signatures/eth.ts` (`ETH_SIGNATURE_PROVIDER`):
  - `getPublicKey`: `SigningKey.computePublicKey(privateKey, true)` → **33-byte
    compressed secp256k1 public key** (0x02/0x03 prefix).
  - `getAddress`: `computeAddress(pubkey).toLowerCase()` → 20-byte ETH address.
  - `sign(data, pk)`: EIP-191 personal-sign digest
    `keccak256("\x19Ethereum Signed Message:\n" + str(len(data)) + data)`,
    then secp256k1 ECDSA; serialized as **65 bytes r‖s‖v** (ethers
    `Signature.serialized`).
  - `verify(data, sig, address)`: `recoverAddress(eip191Digest(data), sig)`
    compared to the address.

Consequences for the notary signer:

1. Every claim/response signature in the artifact is a **65-byte ECDSA
   signature over an EIP-191 digest** — *not* raw keccak256(message) and *not*
   a Schnorr signature.
2. The signer identity on-chain is the **attestor address** (lowercase hex ETH
   address), not the compressed pubkey — but both are derivable from the
   private key. The notary should register/trust attestor address(es).
3. Signature scope (from `lib/proto/api.ts`):
   - `signatures.claimSignature` = EIP-191 signature over
     `stringifyProviderClaimData(claim)` (the claim data, serialized).
   - `signatures.resultSignature` = signature over the whole
     `ClaimTunnelResponse` with the `signatures` field emptied.
   - `signatures.attestorAddress` = the signer's ETH address (hex string).

## 2. Build-start verification #2 — pointing zk-fetch at a custom attestor

**Finding: `@reclaimprotocol/zk-fetch@1.1.0` `ReclaimClient` has NO attestor-URL
option.** Internally it calls `createClaimOnAttestor` (from
`@reclaimprotocol/attestor-core`) with `client: { url }` where the URL comes
from Reclaim's cloud feature-flag API
(`zkFetchAttestorURL` at `https://api.reclaimprotocol.org/api/feature-flags/get`),
falling back to `wss://attestor.reclaimprotocol.org/ws`.

**The supported way to use our self-hosted attestor** (per attestor-core
`docs/getting-started.md` + `docs/run-server.md`): call
`createClaimOnAttestor` directly with `client: { url: 'wss://localhost:8001/ws' }`
— the exact API zk-fetch uses under the hood:

```ts
import { createClaimOnAttestor, createAuthRequest } from '@reclaimprotocol/attestor-core'

const authRequest = await createAuthRequest(
  { userId: 'wf-demo', hostWhitelist: ['www.strava.com'] },
  ATTESTOR_PRIVATE_KEY
)
const rslt = await createClaimOnAttestor({
  name: 'http',
  params: {
    url: 'https://www.strava.com/api/v3/athlete/activities?per_page=5',
    method: 'GET',
    responseMatches: [{ type: 'regex', value: '(?<data>.*)' }],
    responseRedactions: [],
    headers: { accept: 'application/json' },
    body: '',
    paramValues: {},
  },
  secretParams: {
    headers: { authorization: 'Bearer <token>' }, // private — hidden from proof
    cookieStr: '',
    paramValues: {},
  },
  context: { contextAddress: '0x0...', contextMessage: 'wf-demo' },
  ownerPrivateKey: OWNER_KEY, // client-side owner wallet
  client: { url: 'wss://localhost:8001/ws', authRequest },
})
```

Notes:

- `client` is typed `IAttestorClientInitParams { url: string|URL; authRequest? }`.
- `authRequest` is optional unless the attestor runs with
  `AUTHENTICATION_PUBLIC_KEY` set (we run it set; the request is signed with
  the same secp256k1 scheme as §1, using the attestor's own private key).
- `ownerPrivateKey` is the *user's* wallet key; the claim's `owner` field is
  its address. Generated ephemeral per client run is fine.
- Node-side proof generation REQUIRES the ZK artifacts:
  `npm run download:zk-files` (fixed in `packages/client`; downloads
  `resources/` + `bin/` ~334 MB into `@reclaimprotocol/zk-symmetric-crypto@5.1.4`).
  Without it, proof generation fails (snarkjs circuits missing; stwo binaries
  missing).

## 3. Artifact shape (target)

Raw `createClaimOnAttestor` result (`ClaimTunnelResponse`):

```
{
  request: ClaimTunnelRequest,   // tunnel: transcript, reveal plan, IVs, zkEngine
  claim?: ProviderClaimData,     // present on success
  error?: ErrorData,             // present on failure
  signatures: {
    attestorAddress: string,     // ETH address hex (signer identity)
    claimSignature: Uint8Array,  // 65B EIP-191 ECDSA over stringifyProviderClaimData(claim)
    resultSignature: Uint8Array, // 65B EIP-191 ECDSA over response w/ empty signatures
  }
}
```

`ProviderClaimData` (the claim itself):

```
{
  provider: 'http',
  parameters: string,     // JSON: { url, method, headers(public), body, responseMatches, responseRedactions, geoLocation? }
  owner: string,          // ETH address hex of ownerPrivateKey
  timestampS: number,     // unix seconds
  context: string,        // JSON: { contextAddress, contextMessage, extractedParameters?, providerHash }
  identifier: string,     // claim id (hash)
  epoch: number,
}
```

zk-fetch's `transformProof` reshapes this into the public proof object:

```
{
  claimData: ProviderClaimData,
  identifier: string,
  signatures: [ '0x' + hex(claimSignature) ],   // 65B → 130 hex chars
  extractedParameterValues: { data: '...' },    // from responseMatches groups
  witnesses: [ { id: attestorAddress, url: 'wss://localhost:8001/ws' } ],
}
```

Verification API for the notary (attestor-core, same SDK):
`assertValidClaimSignatures({ claim, signatures: { claimSignature, attestorAddress } })`
throws on invalid signature. `decryptTranscript(rslt.request.transcript, logger)`
+ `getTranscriptString` reveal the redacted TLS transcript.

**Section 4 — real artifact dumps (observed 2026-08-06, attestor signer `0xc340fc267cacbb9e3101adced0c7728f7e63b63d`, proof engine `stwo`):**

Observed `ProviderClaimData` (claim):

```jsonc
{
  "provider": "http",
  "parameters": "{\"body\":\"\",\"headers\":{\"User-Agent\":\"reclaim/0.0.1\",\"accept\":\"application/json\"},\"method\":\"GET\",\"paramValues\":{},\"responseMatches\":[{\"type\":\"regex\",\"value\":\"(?<data>.*)\"}],\"responseRedactions\":[],\"url\":\"https://api.github.com/repos/reclaimprotocol/attestor-core\"}",
  "owner": "0x445541beb656e0f2359cae936fda3c404c409194",   // ETH address of client owner key
  "timestampS": 1786063944,
  "context": "{\"contextAddress\":\"0x0000...0000\",\"contextMessage\":\"...\",\"extractedParameters\":{\"data\":\"<FULL HTTP RESPONSE incl. headers>\"},\"providerHash\":\"0x7d72517e...\"}",
  "identifier": "0x88c55dece7deeaeea55e92d9bd17eabcbc27bc5a19ba06896d398bbd6c9ad84d",
  "epoch": 1
}
```

Observed signatures (both 65 bytes = r‖s‖v EIP-191 ECDSA):

```jsonc
{
  "claimSignature":  "0xfc95d3f1...a97e521c",   // 65 bytes, over createSignDataForClaim(claim)
  "resultSignature": "<65 bytes>",              // over ClaimTunnelResponse w/ empty signatures
  "attestorAddress": "0xc340fc267cacbb9e3101adced0c7728f7e63b63d"
}
```

Observed transformed proof (zk-fetch shape — this is what the notary receives):

```jsonc
{
  "claimData": { /* ProviderClaimData as above */ },
  "identifier": "0x88c55dece7deeaeea55e92d9bd17eabcbc27bc5a19ba06896d398bbd6c9ad84d",
  "signatures": ["0xfc95d3f1...a97e521c"],            // 0x + 130 hex chars
  "extractedParameterValues": { "data": "<full HTTP response text>" },
  "witnesses": [{ "id": "0x307863333430666332..." /* hex of ASCII attestorAddress */, "url": "ws://localhost:8001/ws" }]
}
```

Notes for the notary agent:

- `claimIdentifier` (the on-chain nullifier/credential id) = `getIdentifierFromClaimInfo({ context, provider, parameters })` — the `identifier` field. Verify it recomputes.
- `providerHash` inside context binds the provider params — `hashProviderParams(params)`.
- For Strava: `parameters.url` = the activities endpoint; `secretHeaders.authorization` (Bearer token) is NOT in parameters (it lives in the tunnel/transcript only) — the proof proves the request was made with it without revealing it. The notary extracts metrics from `extractedParameterValues.data` (the JSON body after HTTP headers).
- The full HTTP response (headers + body) is captured in `extractedParameterValues.data` because we use the default catch-all regex `(?<data>.*)`. For fixtures we may narrow with a JSON-path redaction so the vault only stores needed fields; default behavior is fine for the demo.
- Engine: `stwo` (fast, ~1s proof gen; assets inline). `snarkjs` also available after `download:zk-files`.

**Saved fixtures (2026-08-07 — REAL STRAVA, gate closed):**

| File | Source | Distance | Moving time | Start date | Verified offline |
|---|---|---|---|---|---|
| `fixture-activity-19643821526-3900m.json` | live-strava (walk, athlete 1390331368) | 3900.3 m | 2942 s | 2026-07-02T23:00:06Z | YES |
| `fixture-activity-19643821429-3545m.json` | live-strava (walk, athlete 1390331368) | 3544.6 m | 3010 s | 2026-07-22T23:31:58Z | YES |
| `fixture-activity-19643822226-2426m.json` | live-strava (walk, athlete 1390331368) | 2426.3 m | 1825 s | 2026-06-21T00:01:27Z | YES |
| `fixture-github-attestor-core-x-0m.json` | public-api (api.github.com) | — | — | — | YES |
| `fixture-github-attestor-core-fresh-x-84m.json` | public-api (api.github.com) | 84 m* | — | — | YES |
| `fixture-github-zk-fetch-reserve-x-0m.json` | public-api (api.github.com) | — | — | — | YES |
| `fixture-coingecko-btc-x-0m.json` | public-api (api.coingecko.com) — retired source | — | — | — | YES |

*github fixture "distance" = stargazers count (fixture-demo mapping); 84 m is
the star count of the attested repo response — an honest fallback, not fake data.

Strava fixtures carry `metadata.athleteId` (real, from the activity's
`athlete.id` — fixed this session; previously the activity id was written),
`activityId`, `distanceM`, `movingTimeS`, `startDate`. Selection for contrast:
sorted by distance, picks max/mid/min (real contrast 3.90 km vs 2.43 km — the
account's walks are 2.4–3.9 km; no 5 km/10 km activities exist). Notary
extraction from these fixtures (verified live, all 3 instances):
metricId 0x1 = distance (real m), metricId 0x2 = moving_time (real s),
source=strava.

## 5. Fixture format (saved proofs)

Versioned JSON per fixture in `packages/client/fixtures/`:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "ISO-8601",
  "source": "live-strava | replay",
  "metadata": { "athleteId": "...", "distanceM": 0, "movingTimeS": 0, "startDate": "ISO-8601", "activityId": "..." },
  "claim": { ...ProviderClaimData },
  "signatureHex": "0x...130 hex chars...",
  "attestorAddress": "0x...",
  "proof": { ...transformed proof object... },
  "transcriptRedacted": { "requestUrl": "...", "responseBody": "...redacted..." }
}
```
       