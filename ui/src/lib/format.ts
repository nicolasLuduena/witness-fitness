// Small formatting helpers for on-chain values.

export const hexShort = (hex: string, lead = 6, tail = 4): string => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length <= lead + tail) return '0x' + clean;
  return `0x${clean.slice(0, lead)}…${clean.slice(-tail)}`;
};

export const fmtKm = (meters: number): string => `${(meters / 1000).toFixed(1)} km`;

export const fmtMinutes = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')} min`;
};

export const fmtTnight = (amount: number): string => `${amount} tNIGHT`;

export const fmtClock = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDate = (epochMs: number): string =>
  new Date(epochMs).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const timeAgo = (epochMs: number): string => {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const shortPubkey = (hex: string): string => hexShort(hex, 8, 8);

// Deterministic 64-hex hash (non-crypto, display-only — used for simulated
// commitments and proof ids in fixture mode).
export function displayHash(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(16).padStart(8, '0');
  const b = (h1 >>> 0).toString(16).padStart(8, '0');
  const c = (h1 >>> 0).toString(16).padStart(8, '0');
  const d = (h2 >>> 0).toString(16).padStart(8, '0');
  return '0x' + a + b + c + d + a + b + c + d;
}
