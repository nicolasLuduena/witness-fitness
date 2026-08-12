# WitnessFitness — Technical Presentation Script

Hello. Imagine a Midnight contract whose decision depends on an external API—for example, a fitness application reading a Strava workout. Making the request is easy. The difficult question is: why should the contract trust the result?

Let us start with HTTPS: HTTP over TLS. TLS encrypts the connection, protects its integrity, and authenticates the server. It tells the client that it reached the real API and received an unmodified response.

But HTTPS does not solve our smart-contract problem.

The user controls both the browser and the values it submits. They can modify the application, bypass the interface, or construct a transaction directly. The Strava connection may have been secure, but the contract never participated in it. To the contract, a genuine response and an invented value can look identical.

So our real problem is not transporting data securely. It is turning an HTTPS response into a claim that another system can verify.

For that, we use zkFetch from Reclaim Protocol with a self-hosted attestor. The client makes a real Strava request through the attestation flow. Reclaim produces proof artifacts showing that the interaction occurred with the expected server and that the claimed data came from its authenticated response, not from the browser.

That gets us much closer, but it creates a second compatibility problem.

Reclaim and Compact use different proof systems, so a Compact contract cannot verify a Reclaim proof natively. Implementing that external verifier inside our circuit was not a practical path for this project.

Our solution is an explicit verification bridge made from three independent notary signers.

Each notary receives the current Reclaim artifact, including the captured Strava response, and independently verifies it using Reclaim's own code. It checks the proof, the expected host, and the required fields. It then extracts only the permitted metrics, such as distance or moving time, into a small, versioned assertion with a timestamp and a unique nonce.

Today, the notaries can temporarily see that API response. Reclaim also supports client-side response redaction, so we can reveal only the fields the assertion requires instead of the full response. Wiring that selective-disclosure path into our notary flow is privacy-hardening work we plan to complete in the coming weeks. The notaries would still see the exact claims they sign, but not unrelated user data. Until then, this is an oracle-style trust boundary, and we make that boundary explicit.

Each notary signs the same typed assertion using Jubjub-Schnorr. Its field order, widths, challenge hashing, and truncation must match the Compact circuit byte for byte. We test that parity by signing off-chain, verifying in the simulator, and changing one byte to confirm that verification fails.

The client collects the signatures and submits the assertion to the Midnight contract. The contract has three registered public keys and requires at least two valid signatures. One compromised signer is therefore not enough to forge a credential. Two signers colluding could still do so, which is the trust assumption of this design—not something zero knowledge magically removes.

Let us quickly recap what we have at this point. The browser produced evidence of a real HTTPS response. Reclaim made that interaction independently verifiable. At least two notaries verified the evidence and signed the same Compact-compatible assertion. We have not put the workout on-chain yet; we have transformed an untrusted browser input into a threshold-attested claim that Midnight can verify.

Once the threshold is satisfied, the Compact circuit checks freshness and consumes the assertion nonce as a nullifier, preventing the same attestation from being registered twice. It derives a pseudonymous holder binding from a private holder secret and stores a persistent commitment to the assertion. The raw Strava response is never written to the ledger.

This is where Midnight becomes more than storage. Later circuits can open that committed credential privately, prove that it belongs to the same holder, and evaluate predicates over its claims. Public state contains the commitment, nullifiers, timestamps, and whatever result the circuit deliberately discloses. The underlying witness data remains private unless the circuit explicitly reveals it.

WitnessFitness is our concrete demonstration of this pipeline. A user authorizes Strava, attests a real workout, obtains signatures from at least two notaries, and registers a holder-bound fitness credential on Midnight.

That credential can drive different mechanics. A wager accepts sealed submissions and prevents one credential from being counted twice. In the current implementation, values remain sealed until settlement, when the public payout branch discloses both openings. Badges demonstrate stronger selective disclosure: the circuit proves a distance threshold or streak requirement without revealing the distance, streak count, or workout dates. A user can prove badge ownership to a specific verifier while remaining pseudonymous.

The important idea is broader than fitness. We now have a reusable path from authenticated web data to private contract logic: HTTPS establishes the server interaction, Reclaim makes that interaction independently verifiable, the notary threshold translates it into a signature scheme Compact can verify, and Midnight turns the signed claim into a private, replay-resistant credential.

In short: do not trust the browser, verify the external interaction, make the trust boundary explicit, and disclose only what the application actually needs.

Now let us show that complete path with a real Strava workout.
