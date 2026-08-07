// Demo sidecar entrypoint (Phase B). Requires: devnet up, 3 notary instances
// running (8101-8103), contract deployed (deploy-output.json or
// CONTRACT_ADDRESS). Reads the contract address at startup so a parallel
// redeploy auto-wires on restart.
//   pnpm --filter @witnessfitness/api start:sidecar
import { createDemoSidecar, loadSidecarConfig } from '../src/demo-sidecar.js';

const config = loadSidecarConfig();
const sidecar = createDemoSidecar(config);

sidecar.server.listen(config.port, () => {
  console.log(
    `[sidecar] listening on :${config.port} | contract ${config.contractAddress || '(unset — set CONTRACT_ADDRESS or deploy the contract)'}`
  );
});

sidecar.init().catch((error) => {
  console.error('[sidecar] init failed — serving /health only:', error);
});
