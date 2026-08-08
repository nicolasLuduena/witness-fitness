// Browser-purity guard: the contract package's root is imported by
// @witnessfitness/api/browser (the wallet-mode bridge). Any node:* import at
// module scope crashes the page (vite externalizes it → the dynamic import
// of the bridge rejects). offchain.ts previously imported node:crypto for
// the fixture-only deriveNonce — the silent-stub symptom. This test keeps
// the browser-loaded graph clean.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('contract browser purity', () => {
  it('offchain.ts has no node:* imports (the wallet bridge loads it in the browser)', () => {
    const src = readFileSync(join(SRC, 'offchain.ts'), 'utf-8');
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/\bBuffer\b/);
  });

  it('the browser-loaded entry files carry no node:* imports', () => {
    for (const file of ['index.ts', 'private-state.ts', 'witnesses.ts']) {
      const src = readFileSync(join(SRC, file), 'utf-8');
      expect(src, file).not.toMatch(/from ['"]node:/);
    }
  });
});
