// Simulator harness mirroring packages/contract/tests/helpers/sim.ts. The
// notary roundtrip gate (ARCHITECTURE.md §4) runs the SAME compiled contract
// + witnesses through the compact-runtime simulator.
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  ledger,
  witnesses,
  type Ledger,
  type PrivateState,
} from "@witnessfitness/contract";

const ADDR = dummyContractAddress();
const COIN_PK = "0".repeat(64);

export class StrideSim {
  private state: unknown;

  readonly contract = new Contract(witnesses);

  constructor(privateState: PrivateState) {
    const deploy = this.contract.initialState(createConstructorContext(privateState, COIN_PK));
    this.state = deploy.currentContractState;
  }

  call(name: string, ps: PrivateState, ...args: unknown[]): unknown {
    const ctx = createCircuitContext(ADDR, COIN_PK, this.state, ps);
    const circuit = (
      this.contract.circuits as Record<string, (c: unknown, ...a: unknown[]) => unknown>
    )[name];
    const res = circuit(ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    return res.result;
  }

  ledgerView(): Ledger {
    return ledger(this.state);
  }
}
