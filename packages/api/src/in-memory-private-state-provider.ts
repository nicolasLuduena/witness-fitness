// In-memory private state provider for the browser build (Track 0.1),
// mirroring midnight-reference-app's in-memory-private-state-provider.ts and
// extending it with WebCrypto-based persistence hooks so the UI can back up
// and resume the app identity (holder secret) in localStorage:
//   exportPrivateState(password, storeName) → {salt, iv, data} base64 JSON
//   importPrivateState(password, storeName, payload) → replace the map
//   resetPrivateState(storeName) → wipe
// All crypto is WebCrypto (crypto.subtle) — no Buffer, no node:crypto — so
// this module is part of the browser bundle. The wire payloads are self-
// contained (salt/iv travel with the ciphertext); a wrong password fails
// AES-GCM authentication with a clear error.
import type { Contract } from "@midnight-ntwrk/compact-js";
import type { SigningKey } from "@midnight-ntwrk/compact-runtime";
import type { ContractAddress } from "@midnight-ntwrk/ledger-v8";
import {
  ExportDecryptionError,
  type ExportPrivateStatesOptions,
  type ExportSigningKeysOptions,
  ImportConflictError,
  type ImportPrivateStatesOptions,
  type ImportPrivateStatesResult,
  type ImportSigningKeysOptions,
  type ImportSigningKeysResult,
  InvalidExportFormatError,
  MAX_EXPORT_SIGNING_KEYS,
  MAX_EXPORT_STATES,
  type PrivateStateExport,
  PrivateStateExportError,
  type PrivateStateId,
  type PrivateStateProvider,
  type SigningKeyExport,
  SigningKeyExportError,
} from "@midnight-ntwrk/midnight-js-types";

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 16;
const CURRENT_EXPORT_VERSION = 1;
const SUPPORTED_EXPORT_VERSIONS = [1];

interface PrivateStatePayload<PSI extends PrivateStateId = PrivateStateId> {
  readonly version: number;
  readonly exportedAt: string;
  readonly stateCount: number;
  readonly states: Record<PSI, string>;
}

interface SigningKeyPayload {
  readonly version: number;
  readonly exportedAt: string;
  readonly keyCount: number;
  readonly keys: Record<string, string>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// PrivateState carries bigints and Uint8Arrays, which JSON.stringify cannot
// serialize directly — tag them so the import can revive the exact shapes.
const serializeValue = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return { $bigint: value.toString(16) };
  }
  if (value instanceof Uint8Array) {
    return { $bytes: bytesToHex(value) };
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeValue(v)]),
    );
  }
  return value;
};

const deserializeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$bigint === "string") {
      return BigInt("0x" + record.$bigint);
    }
    if (typeof record.$bytes === "string") {
      return hexToBytes(record.$bytes);
    }
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, deserializeValue(v)]));
  }
  return value;
};

const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  // Uint8Array is a valid BufferSource at runtime; the DOM lib's generic
  // Uint8Array<ArrayBufferLike> typing is stricter than WebCrypto accepts.
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
};

const encrypt = async (
  plaintext: string,
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> => {
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      encoder.encode(plaintext),
    ),
  );
  return new Uint8Array([iv.length, ...iv, ...data]);
};

const decrypt = async (blob: Uint8Array, password: string, salt: Uint8Array): Promise<string> => {
  const ivLength = blob[0];
  const iv = blob.subarray(1, 1 + ivLength);
  const data = blob.subarray(1 + ivLength);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  return decoder.decode(plaintext);
};

const validatePassword = (password: string, what: string): void => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${what}: password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
};

export interface InMemoryPrivateStateProvider<
  PSI extends PrivateStateId,
  PS extends Contract.PrivateState<Contract.Any>,
> extends PrivateStateProvider<PSI, PS> {
  // Browser persistence hooks (Track 0.1 seam — exact shapes for the UI):
  // exportPrivateState returns a base64-JSON string ready for localStorage.
  exportPrivateState(password: string, storeName: string): Promise<string>;
  importPrivateState(password: string, storeName: string, payload: string): Promise<void>;
  resetPrivateState(storeName: string): void;
}

export const inMemoryPrivateStateProvider = <
  PSI extends PrivateStateId,
  PS extends Contract.PrivateState<Contract.Any>,
>(): InMemoryPrivateStateProvider<PSI, PS> => {
  const record = new Map<string, PS>();
  const signingKeys = new Map<string, SigningKey>();
  let contractAddress: ContractAddress | null = null;

  const getScopedKey = (key: PSI): string => {
    if (contractAddress === null) {
      throw new Error(
        "Contract address not set. Call setContractAddress() before accessing private state.",
      );
    }
    return `${contractAddress}:${key}`;
  };

  const exportPayload = async (
    password: string,
    storeName: string,
  ): Promise<{ salt: Uint8Array; iv: Uint8Array; data: Uint8Array; plaintext: string }> => {
    validatePassword(password, "exportPrivateState");
    if (record.size === 0) {
      throw new Error("No private states to export");
    }
    const payload: PrivateStatePayload<PSI> = {
      version: CURRENT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      stateCount: record.size,
      states: Object.fromEntries(
        Array.from(record.entries()).map(([key, value]) => [
          key,
          JSON.stringify(serializeValue(value)),
        ]),
      ) as Record<PSI, string>,
    };
    const plaintext = JSON.stringify({ store: storeName, ...payload });
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const blob = await encrypt(plaintext, password, salt);
    const iv = blob.subarray(1, 1 + blob[0]);
    const data = blob.subarray(1 + blob[0]);
    return { salt, iv, data, plaintext };
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },

    set(key: PSI, state: PS): Promise<void> {
      record.set(getScopedKey(key), state);
      return Promise.resolve();
    },

    get(key: PSI): Promise<PS | null> {
      return Promise.resolve(record.get(getScopedKey(key)) ?? null);
    },

    remove(key: PSI): Promise<void> {
      record.delete(getScopedKey(key));
      return Promise.resolve();
    },

    clear(): Promise<void> {
      record.clear();
      return Promise.resolve();
    },

    setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address, signingKey);
      return Promise.resolve();
    },

    getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return Promise.resolve(signingKeys.get(address) ?? null);
    },

    removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
      return Promise.resolve();
    },

    clearSigningKeys(): Promise<void> {
      signingKeys.clear();
      return Promise.resolve();
    },

    async exportPrivateState(password: string, storeName: string): Promise<string> {
      const { salt, iv, data } = await exportPayload(password, storeName);
      return JSON.stringify({
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(data),
      });
    },

    async importPrivateState(password: string, storeName: string, payload: string): Promise<void> {
      validatePassword(password, "importPrivateState");
      let parsed: { salt?: unknown; iv?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        throw new ExportDecryptionError();
      }
      if (
        typeof parsed.salt !== "string" ||
        typeof parsed.iv !== "string" ||
        typeof parsed.data !== "string"
      ) {
        throw new InvalidExportFormatError("Malformed payload: expected { salt, iv, data }");
      }
      let plaintext: string;
      try {
        plaintext = await decrypt(
          new Uint8Array([
            base64ToBytes(parsed.iv).length,
            ...base64ToBytes(parsed.iv),
            ...base64ToBytes(parsed.data),
          ]),
          password,
          base64ToBytes(parsed.salt),
        );
      } catch {
        throw new ExportDecryptionError();
      }
      let imported: { stateCount?: unknown; states?: unknown };
      try {
        imported = JSON.parse(plaintext) as typeof imported;
      } catch {
        throw new ExportDecryptionError();
      }
      const states = imported.states as Record<string, string> | undefined;
      if (
        states === null ||
        typeof states !== "object" ||
        typeof imported.stateCount !== "number" ||
        imported.stateCount !== Object.keys(states).length
      ) {
        throw new ExportDecryptionError();
      }
      const repopulated = new Map<string, PS>();
      for (const [key, serialized] of Object.entries(states)) {
        let state: PS;
        try {
          state = deserializeValue(JSON.parse(serialized)) as PS;
        } catch {
          throw new ExportDecryptionError();
        }
        repopulated.set(key, state);
      }
      record.clear();
      for (const [key, state] of repopulated.entries()) {
        record.set(key, state);
      }
      void storeName;
    },

    resetPrivateState(storeName: string): void {
      void storeName;
      record.clear();
    },

    async exportPrivateStates(options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      const maxStates = options?.maxStates ?? MAX_EXPORT_STATES;
      if (!options?.password) {
        throw new PrivateStateExportError("Password is required for in-memory provider export");
      }
      validatePassword(options.password, "exportPrivateStates");
      if (record.size === 0) {
        throw new PrivateStateExportError("No private states to export");
      }
      if (record.size > maxStates) {
        throw new PrivateStateExportError(
          `Too many states to export (${record.size}). Maximum allowed: ${maxStates}`,
        );
      }
      const { salt, blob } = await (async () => {
        const payload: PrivateStatePayload<PSI> = {
          version: CURRENT_EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          stateCount: record.size,
          states: Object.fromEntries(
            Array.from(record.entries()).map(([key, value]) => [
              key,
              JSON.stringify(serializeValue(value)),
            ]),
          ) as Record<PSI, string>,
        };
        const salt = crypto.getRandomValues(new Uint8Array(32));
        const blob = await encrypt(JSON.stringify(payload), options.password!, salt);
        return { salt, blob };
      })();
      return {
        format: "midnight-private-state-export",
        encryptedPayload: bytesToBase64(blob),
        salt: bytesToHex(salt),
      };
    },

    async importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      const conflictStrategy = options?.conflictStrategy ?? "error";
      if (exportData.format !== "midnight-private-state-export") {
        throw new InvalidExportFormatError("Unrecognized export format");
      }
      if (!exportData.encryptedPayload || !exportData.salt) {
        throw new InvalidExportFormatError("Missing required fields");
      }
      if (!options?.password) {
        throw new InvalidExportFormatError("Password is required for in-memory provider import");
      }
      validatePassword(options.password, "importPrivateStates");
      let payload: PrivateStatePayload<PSI>;
      try {
        payload = JSON.parse(
          await decrypt(
            base64ToBytes(exportData.encryptedPayload),
            options.password,
            hexToBytes(exportData.salt),
          ),
        ) as PrivateStatePayload<PSI>;
      } catch {
        throw new ExportDecryptionError();
      }
      if (
        !payload.states ||
        typeof payload.states !== "object" ||
        typeof payload.version !== "number" ||
        typeof payload.stateCount !== "number" ||
        !SUPPORTED_EXPORT_VERSIONS.includes(payload.version)
      ) {
        throw new ExportDecryptionError();
      }
      const stateIds = Object.keys(payload.states) as PSI[];
      if (stateIds.length !== payload.stateCount || stateIds.length > maxStatesOf(options)) {
        throw new ExportDecryptionError();
      }
      if (conflictStrategy === "error") {
        const conflicts = stateIds.filter((id) => record.has(id as string)).length;
        if (conflicts > 0) {
          throw new ImportConflictError(conflicts);
        }
      }
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const stateId of stateIds) {
        const existing = record.get(stateId as string);
        if (existing !== undefined) {
          if (conflictStrategy === "skip") {
            skipped += 1;
            continue;
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        record.set(stateId as string, deserializeValue(JSON.parse(payload.states[stateId])) as PS);
      }
      return { imported, skipped, overwritten };
    },

    async exportSigningKeys(options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      const maxKeys = options?.maxKeys ?? MAX_EXPORT_SIGNING_KEYS;
      if (!options?.password) {
        throw new SigningKeyExportError("Password is required for in-memory provider export");
      }
      validatePassword(options.password, "exportSigningKeys");
      if (signingKeys.size === 0) {
        throw new SigningKeyExportError("No signing keys to export");
      }
      if (signingKeys.size > maxKeys) {
        throw new SigningKeyExportError(
          `Too many keys to export (${signingKeys.size}). Maximum allowed: ${maxKeys}`,
        );
      }
      const payload: SigningKeyPayload = {
        version: CURRENT_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        keyCount: signingKeys.size,
        keys: Object.fromEntries(
          Array.from(signingKeys.entries()).map(([address, key]) => [
            address,
            JSON.stringify(serializeValue(key)),
          ]),
        ),
      };
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const blob = await encrypt(JSON.stringify(payload), options.password, salt);
      return {
        format: "midnight-signing-key-export",
        encryptedPayload: bytesToBase64(blob),
        salt: bytesToHex(salt),
      };
    },

    async importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      const conflictStrategy = options?.conflictStrategy ?? "error";
      if (exportData.format !== "midnight-signing-key-export") {
        throw new InvalidExportFormatError("Unrecognized export format");
      }
      if (!exportData.encryptedPayload || !exportData.salt) {
        throw new InvalidExportFormatError("Missing required fields");
      }
      if (!options?.password) {
        throw new InvalidExportFormatError("Password is required for in-memory provider import");
      }
      validatePassword(options.password, "importSigningKeys");
      let payload: SigningKeyPayload;
      try {
        payload = JSON.parse(
          await decrypt(
            base64ToBytes(exportData.encryptedPayload),
            options.password,
            hexToBytes(exportData.salt),
          ),
        ) as SigningKeyPayload;
      } catch {
        throw new ExportDecryptionError();
      }
      if (
        !payload.keys ||
        typeof payload.keys !== "object" ||
        typeof payload.version !== "number" ||
        typeof payload.keyCount !== "number" ||
        payload.keyCount !== Object.keys(payload.keys).length
      ) {
        throw new ExportDecryptionError();
      }
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const [address, serialized] of Object.entries(payload.keys)) {
        const existing = signingKeys.get(address);
        if (existing !== undefined) {
          if (conflictStrategy === "skip") {
            skipped += 1;
            continue;
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        signingKeys.set(address, deserializeValue(JSON.parse(serialized)) as SigningKey);
      }
      return { imported, skipped, overwritten };
    },
  };
};

const maxStatesOf = (options?: ImportPrivateStatesOptions): number =>
  options?.maxStates ?? MAX_EXPORT_STATES;
