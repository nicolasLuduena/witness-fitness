import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidClaimSignatures, proto } from '@reclaimprotocol/attestor-core'
import { transformProof, type AttestResult } from './attest.ts'

type ProviderClaimData = proto.ProviderClaimData
type ClaimTunnelResponse = proto.ClaimTunnelResponse

export const SRC_DIR = dirname(fileURLToPath(import.meta.url))
export const FIXTURES_DIR = join(SRC_DIR, '..', 'fixtures')

export interface FixtureFile {
  schemaVersion: number
  generatedAt: string
  source: 'live-strava' | 'public-api' | 'replay'
  metadata: {
    athleteId?: number
    activityId?: number
    distanceM?: number
    movingTimeS?: number
    startDate?: string
    url: string
    label?: string
  }
  request: { url: string; method: string; publicHeaders: Record<string, string> }
  responseText: string
  claim: ProviderClaimData
  signatureHex: string
  attestorAddress: string
  proof: ReturnType<typeof transformProof>
}

export async function saveFixture(
  result: AttestResult,
  meta: FixtureFile['metadata'],
  source: FixtureFile['source'],
): Promise<string> {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const responseText = result.proof.extractedParameterValues['data'] ?? ''
  const fixture: FixtureFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    metadata: meta,
    request: {
      url: meta.url,
      method: 'GET',
      publicHeaders: { accept: 'application/json' },
    },
    responseText,
    claim: result.claim.claim!,
    signatureHex: result.proof.signatures[0],
    attestorAddress: result.claim.signatures!.attestorAddress,
    proof: result.proof,
  }
  const name = `fixture-${meta.label ?? 'activity'}-${meta.activityId ?? 'x'}-${Math.round(meta.distanceM ?? 0)}m.json`
  const path = join(FIXTURES_DIR, name)
  writeFileSync(path, JSON.stringify(fixture, null, 2))
  return path
}

export async function verifyFixture(fixture: FixtureFile): Promise<void> {
  const signatures = {
    claimSignature: new Uint8Array(Buffer.from(fixture.signatureHex.slice(2), 'hex')),
    attestorAddress: fixture.attestorAddress,
  } as ClaimTunnelResponse['signatures']
  await assertValidClaimSignatures({ claim: fixture.claim, signatures })
}
