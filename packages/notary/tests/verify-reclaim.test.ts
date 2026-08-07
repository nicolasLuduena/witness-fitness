// NOTARY.md §6.1 — verify-reclaim accepts genuine fixture proofs (offline,
// same SDK that produced them) and rejects tampered artifacts; host and
// response sanity checks fail loudly.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertAllowedHost,
  normalizeArtifacts,
  parseResponseBody,
  verifyReclaimProof,
  type ProofArtifacts,
} from '../src/verify-reclaim.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'fixtures');

const loadFixture = (name: string): ProofArtifacts =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));

describe('verify-reclaim', () => {
  it('accepts genuine fixture proofs (github)', async () => {
    for (const name of [
      'fixture-github-attestor-core-x-0m.json',
      'fixture-github-attestor-core-fresh-x-84m.json',
    ]) {
      const artifacts = loadFixture(name);
      const verified = await verifyReclaimProof(artifacts, [
        'strava.com',
        'api.github.com',
      ]);
      expect(verified.identifier).toBe(artifacts.claim.identifier);
      expect(verified.responseText.length).toBeGreaterThan(0);
    }
  });

  it('rejects a tampered claim signature', async () => {
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const tampered: ProofArtifacts = {
      ...artifacts,
      signatureHex: '0x' + Buffer.from(artifacts.signatureHex.slice(2), 'hex').reverse().toString('hex'),
    };
    await expect(
      verifyReclaimProof(tampered, ['api.github.com'])
    ).rejects.toThrow();
  });

  it('rejects a tampered claim body (signature no longer matches)', async () => {
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const tampered: ProofArtifacts = {
      ...artifacts,
      claim: { ...artifacts.claim, timestampS: artifacts.claim.timestampS + 1 },
    };
    await expect(verifyReclaimProof(tampered, ['api.github.com'])).rejects.toThrow();
  });

  it('rejects a host outside the allowlist', async () => {
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const verified = await verifyReclaimProof(artifacts, ['api.github.com']);
    expect(() => assertAllowedHost(verified.claim, ['www.strava.com'])).toThrow(
      /not in allowlist/
    );
  });

  it('rejects an unparseable captured response', () => {
    expect(() => parseResponseBody('HTTP/1.1 200 OK\r\n\r\nnot-json{')).toThrow();
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const bad = { ...artifacts, responseText: 'garbage' };
    expect(() => parseResponseBody(bad.responseText!)).toThrow();
  });

  it('normalizes the live zk-fetch proof shape', () => {
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const live = {
      claimData: artifacts.claim,
      identifier: artifacts.claim.identifier,
      signatures: [artifacts.signatureHex],
      extractedParameterValues: { data: artifacts.responseText },
      witnesses: [
        {
          id: '0x' + Buffer.from(artifacts.attestorAddress, 'utf-8').toString('hex'),
          url: 'ws://localhost:8001/ws',
        },
      ],
    };
    const normalized = normalizeArtifacts(live);
    expect(normalized.attestorAddress).toBe(artifacts.attestorAddress);
    expect(normalized.signatureHex).toBe(artifacts.signatureHex);
  });

  it('accepts the UI ProofArtifacts shape (claimSignatureHex alias)', async () => {
    const artifacts = loadFixture('fixture-github-attestor-core-x-0m.json');
    const uiShape = {
      claim: artifacts.claim,
      claimSignatureHex: artifacts.signatureHex,
      attestorAddress: artifacts.attestorAddress,
      request: artifacts.request,
      responseText: artifacts.responseText,
      extractedParameterValues: artifacts.proof.extractedParameterValues,
    };
    const normalized = normalizeArtifacts(uiShape);
    expect(normalized.signatureHex).toBe(artifacts.signatureHex);
    const verified = await verifyReclaimProof(normalized, ['api.github.com']);
    expect(verified.identifier).toBe(artifacts.claim.identifier);
  });
});
