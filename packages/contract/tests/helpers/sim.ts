import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
  type Effects,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, type Ledger } from '../../src/managed/stride/contract/index.js';
import { witnesses } from '../../src/witnesses.js';
import type { PrivateState } from '../../src/private-state.js';

const ADDR = dummyContractAddress();
const COIN_PK = '0'.repeat(64);

export class StrideSim {
  private state: Contract['initialState'] extends never ? never : any;
  private lastEffects: Effects | null = null;

  readonly contract = new Contract(witnesses);

  constructor(privateState: PrivateState) {
    const deploy = this.contract.initialState(createConstructorContext(privateState, COIN_PK));
    this.state = deploy.currentContractState;
  }

  call(name: string, ps: PrivateState, ...args: unknown[]): any {
    const ctx = createCircuitContext(ADDR, COIN_PK, this.state, ps);
    const circuit = (this.contract.circuits as Record<string, (c: unknown, ...a: unknown[]) => any>)[
      name
    ];
    const res = circuit(ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    this.lastEffects = res.context.currentQueryContext.effects;
    return res.result;
  }

  // Effects of the most recent call: unshieldedInputs (deposits into the
  // contract), unshieldedOutputs (payouts), shieldedMints (winner NFTs).
  effects(): Effects {
    if (!this.lastEffects) {
      throw new Error('no circuit call executed yet');
    }
    return this.lastEffects;
  }

  // Total NIGHT deposited into the contract by the last call (receiveUnshielded).
  unshieldedInputSum(): bigint {
    let total = 0n;
    for (const amount of this.effects().unshieldedInputs.values()) {
      total += amount;
    }
    return total;
  }

  // Total NIGHT the last call paid out of the contract (sendUnshielded).
  unshieldedOutputSum(): bigint {
    let total = 0n;
    for (const amount of this.effects().unshieldedOutputs.values()) {
      total += amount;
    }
    return total;
  }

  // Winner-NFT mints in the last call (map: hex domain separator -> value).
  shieldedMints(): Map<string, bigint> {
    return this.effects().shieldedMints;
  }

  ledgerView(): Ledger {
    return ledger(this.state);
  }
}
