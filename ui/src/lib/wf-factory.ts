// WfClient factory — mode is decided once at startup (config default = wallet,
// ?mode=live for maintainer debugging with the identity sidecar). The live
// client is lazy-imported so the default wallet mode never pays for it.

import type { DemoMode } from '../config';
import type { WfClient } from './wf-client';

let cached: WfClient | null = null;

export const createWfClient = (mode: DemoMode): WfClient => {
  if (cached?.mode === mode) return cached;
  cached = mode === 'live' ? new LiveClientProxy() : new WalletClientProxy();
  return cached;
};

class WalletClientProxy implements WfClient {
  readonly mode: DemoMode = 'wallet';
  private inner: WfClient | null = null;

  private async real(): Promise<WfClient> {
    if (!this.inner) {
      const { WalletClient } = await import('./wallet-client');
      this.inner = new WalletClient();
    }
    return this.inner;
  }

  connect() {
    return this.real().then((c) => c.connect());
  }
  attest() {
    return this.real().then((c) => c.attest());
  }
  vault() {
    return this.real().then((c) => c.vault());
  }
  listWagers() {
    return this.real().then((c) => c.listWagers());
  }
  createWager(req: Parameters<WfClient['createWager']>[0]) {
    return this.real().then((c) => c.createWager(req));
  }
  acceptWager(id: number) {
    return this.real().then((c) => c.acceptWager(id));
  }
  submitWorkout(id: number, credentialId: string) {
    return this.real().then((c) => c.submitWorkout(id, credentialId));
  }
  settleWager(id: number) {
    return this.real().then((c) => c.settleWager(id));
  }
  streak() {
    return this.real().then((c) => c.streak());
  }
  advanceStreak() {
    return this.real().then((c) => c.advanceStreak());
  }
  badges() {
    return this.real().then((c) => c.badges());
  }
  mintBadge(badgeId: number) {
    return this.real().then((c) => c.mintBadge(badgeId));
  }
  proveBadge(badgeId: number, verifier: string) {
    return this.real().then((c) => c.proveBadge(badgeId, verifier));
  }
  notaryStatus() {
    return this.real().then((c) => c.notaryStatus());
  }
  backupPrivateState(password: string) {
    return this.real().then((c) => {
      if (!c.backupPrivateState) throw new Error('backup not supported in this mode');
      return c.backupPrivateState(password);
    });
  }
  restorePrivateState(password: string, payload: string) {
    return this.real().then((c) => {
      if (!c.restorePrivateState) throw new Error('restore not supported in this mode');
      return c.restorePrivateState(password, payload);
    });
  }
  resetPrivateState() {
    return this.real().then((c) => {
      if (!c.resetPrivateState) throw new Error('reset not supported in this mode');
      return c.resetPrivateState();
    });
  }
}

class LiveClientProxy implements WfClient {
  readonly mode: DemoMode = 'live';
  private inner: WfClient | null = null;

  private async real(): Promise<WfClient> {
    if (!this.inner) {
      const { LiveClient } = await import('./live-client');
      this.inner = new LiveClient();
    }
    return this.inner;
  }

  connect() {
    return this.real().then((c) => c.connect());
  }
  attest() {
    return this.real().then((c) => c.attest());
  }
  vault() {
    return this.real().then((c) => c.vault());
  }
  listWagers() {
    return this.real().then((c) => c.listWagers());
  }
  createWager(req: Parameters<WfClient['createWager']>[0]) {
    return this.real().then((c) => c.createWager(req));
  }
  acceptWager(id: number) {
    return this.real().then((c) => c.acceptWager(id));
  }
  submitWorkout(id: number, credentialId: string) {
    return this.real().then((c) => c.submitWorkout(id, credentialId));
  }
  settleWager(id: number) {
    return this.real().then((c) => c.settleWager(id));
  }
  streak() {
    return this.real().then((c) => c.streak());
  }
  advanceStreak() {
    return this.real().then((c) => c.advanceStreak());
  }
  badges() {
    return this.real().then((c) => c.badges());
  }
  mintBadge(badgeId: number) {
    return this.real().then((c) => c.mintBadge(badgeId));
  }
  proveBadge(badgeId: number, verifier: string) {
    return this.real().then((c) => c.proveBadge(badgeId, verifier));
  }
  notaryStatus() {
    return this.real().then((c) => c.notaryStatus());
  }
}
