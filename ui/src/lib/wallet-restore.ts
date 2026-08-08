// Wallet-mode restore/resume helpers (Track 0.2 polish). Pure + testable:
// the backup lives in localStorage under `wf-wallet-backup-<addr-suffix>`;
// restore ALWAYS loads the payload from storage — never from user input.

const BACKUP_KEY_PREFIX = "wf-wallet-backup";

export const walletBackupKey = (address: string): string =>
  `${BACKUP_KEY_PREFIX}-${address.slice(-16)}`;

export const readStoredBackup = (address: string): string | null => {
  const value = localStorage.getItem(walletBackupKey(address));
  return value === null ? null : value;
};

export const storeBackupPayload = (address: string, payload: string): void => {
  localStorage.setItem(walletBackupKey(address), payload);
};

export const hasStoredBackup = (address: string): boolean => readStoredBackup(address) !== null;

// Restore orchestration: reads the stored payload and hands it to the bridge
// (importPrivateState(password, storeName, payload)). The password is the only
// user input; a wrong password must not touch the stored backup (we only read).
export const performRestore = async (opts: {
  address: string;
  password: string;
  restorePrivateState: (password: string, payload: string) => Promise<void>;
}): Promise<void> => {
  const payload = readStoredBackup(opts.address);
  if (payload === null) {
    throw new Error("no backup stored for this wallet");
  }
  await opts.restorePrivateState(opts.password, payload);
};

// Auto-resume decision on reload/connect: prompt for the password only when a
// backup exists AND no live session/private state is present AND we have not
// already prompted this session.
export const shouldAutoResume = (opts: {
  hasBackup: boolean;
  hasCredentials: boolean;
  alreadyPrompted: boolean;
}): boolean => opts.hasBackup && !opts.hasCredentials && !opts.alreadyPrompted;
