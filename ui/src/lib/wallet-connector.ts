// Wallet connector — the Lace DApp Connector flow for mode=wallet.
// Discovery (window.midnight) → apiVersion check → connect(networkId) →
// configuration/networkId verification → address snapshot. Mirrors the
// reference app's wallet context pattern.

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { MIN_WALLET_API_VERSION, NETWORK_ID } from '../config';

export class WalletUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletUnavailableError';
  }
}

export interface WalletConnection {
  api: ConnectedAPI;
  rdns: string;
  name: string;
  apiVersion: string;
  shieldedAddress: string;
  coinPublicKey: string;
  networkId: string;
}

const API_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)/;

const versionAtLeast = (version: string, minimum: string): boolean => {
  const v = API_VERSION_PATTERN.exec(version);
  const m = API_VERSION_PATTERN.exec(minimum);
  if (!v || !m) return false;
  const [vmaj, vmin, vpat] = v.slice(1).map(Number);
  const [mmaj, mmin, mpat] = m.slice(1).map(Number);
  return vmaj > mmaj || (vmaj === mmaj && (vmin > mmin || (vmin === mmin && vpat >= mpat)));
};

export const discoverWallets = (): InitialAPI[] => {
  const midnight = (window as Window & { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight) return [];
  return Object.values(midnight);
};

export interface WalletSummary {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
}

// All installed Midnight wallets (Lace, 1am, …) with their display metadata —
// the Connect screen shows this list when more than one wallet is installed.
export const discoverWalletSummaries = (): WalletSummary[] => {
  const midnight = (window as Window & { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight) return [];
  return Object.entries(midnight).map(([rdns, api]) => ({
    rdns,
    name: api.name ?? rdns,
    icon: api.icon ?? '',
    apiVersion: api.apiVersion,
  }));
};

export const connectWallet = async (
  networkId = NETWORK_ID,
  rdns?: string,
): Promise<WalletConnection> => {
  const midnight = (window as Window & { midnight?: Record<string, InitialAPI> }).midnight;
  const wallets = discoverWallets();
  if (wallets.length === 0) {
    throw new WalletUnavailableError(
      'No Midnight wallet detected — install a wallet extension (e.g. Lace)'
    );
  }
  const chosen = rdns ? midnight?.[rdns] : wallets[0];
  if (!chosen) {
    throw new WalletUnavailableError(`Wallet "${rdns}" not found`);
  }
  const wallet = chosen;
  if (!versionAtLeast(wallet.apiVersion, MIN_WALLET_API_VERSION)) {
    throw new WalletUnavailableError(
      `Wallet apiVersion ${wallet.apiVersion} is too old — need >= ${MIN_WALLET_API_VERSION}.`
    );
  }

  const api = await wallet.connect(networkId);
  const [configuration, connectionStatus, shielded] = await Promise.all([
    api.getConfiguration(),
    api.getConnectionStatus(),
    api.getShieldedAddresses(),
  ]);

  if (connectionStatus.status !== 'connected') {
    throw new WalletUnavailableError('Wallet is not connected to a network — switch to demo mode');
  }
  if (configuration.networkId !== networkId) {
    throw new WalletUnavailableError(
      `Wallet is on network "${configuration.networkId}" but the devnet is "${networkId}" — point Lace at the local devnet or switch to demo mode`
    );
  }

  return {
    api,
    rdns: rdns ?? Object.keys(window.midnight ?? {})[0] ?? 'unknown',
    name: wallet.name,
    apiVersion: wallet.apiVersion,
    shieldedAddress: shielded.shieldedAddress,
    coinPublicKey: shielded.shieldedCoinPublicKey,
    networkId: configuration.networkId,
  };
};
