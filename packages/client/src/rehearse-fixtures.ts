import 'dotenv/config'
import { attestRequest, loadAttestorConfig } from './attest.ts'
import { saveFixture, verifyFixture } from './fixtures.ts'

process.env.ATTESTOR_HOST_WHITELIST = 'api.github.com'
const config = loadAttestorConfig()

const targets = [
  {
    url: 'https://api.github.com/repos/reclaimprotocol/attestor-core',
    label: 'github-attestor-core',
  },
]

for (const target of targets) {
  const result = await attestRequest(
    {
      url: target.url,
      method: 'GET',
      publicHeaders: { accept: 'application/json' },
      context: {
        contextAddress: '0x0000000000000000000000000000000000000000',
        contextMessage: `witnessfitness:rehearsal:${target.label}`,
      },
    },
    config,
  )
  const path = await saveFixture(
    result,
    { url: target.url, label: target.label },
    'public-api',
  )
  console.log('saved fixture:', path)
  await verifyFixture(JSON.parse(await import('node:fs').then((fs) => fs.promises.readFile(path, 'utf-8'))))
  console.log('  offline re-verification OK:', target.label)
}
