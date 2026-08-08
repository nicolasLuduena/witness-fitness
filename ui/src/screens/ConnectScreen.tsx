// Connect — Strava OAuth → live attestation. The "real crypto happening live"
// moment: staged status line (witnessing TLS → notarizing → on-chain).
// Two modes: wallet (Lace DApp Connector — the default) and live (demo
// sidecar :8200, maintainer debug via ?mode=live).

import { ArrowLeft, KeyRound, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Chip, Notice, Stat } from "../components/bits";
import { StatusLine } from "../components/StatusLine";
import { hexShort } from "../lib/format";
import { logError } from "../lib/logger";
import { discoverWalletSummaries, type WalletSummary } from "../lib/wallet-connector";
import {
  hasStoredBackup,
  performRestore,
  shouldAutoResume,
  storeBackupPayload,
  walletBackupKey,
} from "../lib/wallet-restore";
import { useDemo } from "../state/DemoStore";

export const ConnectScreen = () => {
  const {
    mode,
    session,
    connecting,
    connectError,
    connect,
    client,
    attest,
    attestRunning,
    attestStages,
    attestOutcome,
    credentials,
    backupPrivateState,
    restorePrivateState,
  } = useDemo();
  const [attestError, setAttestError] = useState<string | null>(null);
  const [strava, setStrava] = useState<{
    connected: boolean;
    athleteName?: string;
  } | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [recoveryView, setRecoveryView] = useState<"backup" | "restore">("backup");
  const [restoreMode, setRestoreMode] = useState<"restore" | "resume">("restore");
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const resumePrompted = useRef(false);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [pickedRdns, setPickedRdns] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isWallet = mode === "wallet";
  const isLive = mode === "live";
  const outcome = attestOutcome?.credential;

  // Wallet discovery: when more than one Midnight wallet is installed
  // (Lace, 1am, …), let the user pick; a single wallet auto-connects.
  useEffect(() => {
    if (!isWallet || session) {
      setWallets([]);
      return;
    }
    setWallets(discoverWalletSummaries());
  }, [isWallet, session]);

  const handleConnect = () => void connect(pickedRdns ?? undefined);

  // A picker row connects that wallet immediately (no select-then-connect
  // step); the primary button below still connects the selected/first wallet.
  const handlePickWallet = (rdns: string) => {
    setPickedRdns(rdns);
    void connect(rdns);
  };

  const handleCopyBinding = async () => {
    const binding = session?.athlete.holderBinding;
    if (!binding) return;
    try {
      await navigator.clipboard.writeText(binding);
      setCopiedId(binding);
      window.setTimeout(() => setCopiedId(null), 1_500);
    } catch (err) {
      logError("ConnectScreen.copyBinding", err);
      setAttestError("clipboard unavailable");
    }
  };

  const handleConnectStrava = () => {
    try {
      client.connectStrava?.();
    } catch (err) {
      logError("ConnectScreen.stravaRedirect", err);
      setAttestError(err instanceof Error ? err.message : "strava oauth failed");
    }
  };

  // Strava surface (wallet mode): process a /strava/callback redirect on
  // load, then show the live connect state from the token store.
  useEffect(() => {
    if (!isWallet || !session || !client.handleStravaRedirect) return;
    let cancelled = false;
    (async () => {
      try {
        const handled = await client.handleStravaRedirect?.();
        if (!cancelled && handled) {
          setStrava(client.stravaStatus?.() ?? null);
        }
      } catch (err) {
        logError("ConnectScreen.stravaCallback", err);
        setAttestError(err instanceof Error ? err.message : "strava oauth failed");
      }
    })();
    setStrava(client.stravaStatus?.() ?? null);
    return () => {
      cancelled = true;
    };
  }, [isWallet, session, client]);

  const handleAttest = async () => {
    setAttestError(null);
    try {
      await attest();
      setStrava(client.stravaStatus?.() ?? null);
    } catch (err) {
      logError("ConnectScreen.attest", err);
      setAttestError(err instanceof Error ? err.message : "attestation failed");
    }
  };

  const backupKey = session?.walletAddress ? walletBackupKey(session.walletAddress) : null;
  const hasBackup = session?.walletAddress ? hasStoredBackup(session.walletAddress) : false;

  const handleBackup = async () => {
    if (!backupPrivateState || !backupPassword || backupKey === null) return;
    setBackupBusy(true);
    setBackupNotice(null);
    try {
      const payload = await backupPrivateState(backupPassword);
      storeBackupPayload(session?.walletAddress ?? "", payload);
      setBackupPassword("");
      setRestoreNotice(null);
      setBackupNotice({
        tone: "success",
        message: "Encrypted backup saved in this browser for this wallet.",
      });
    } catch (err) {
      logError("ConnectScreen.backup", err);
      setBackupNotice({
        tone: "error",
        message: "We couldn’t save the encrypted backup. Try again.",
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const openRestorePrompt = useCallback((mode: "restore" | "resume") => {
    setBackupNotice(null);
    setRestoreNotice(null);
    setRestorePassword("");
    setRestoreMode(mode);
    setRecoveryView("restore");
  }, []);

  const handleRestore = async () => {
    if (!restorePrivateState || !restorePassword || restoreBusy) return;
    if (!session?.walletAddress) return;
    setRestoreBusy(true);
    setRestoreNotice(null);
    try {
      await performRestore({
        address: session.walletAddress,
        password: restorePassword,
        restorePrivateState,
      });
      setBackupNotice({
        tone: "success",
        message: "Private state restored. Your sealed credentials are available again.",
      });
      setRestoreNotice(null);
      setRecoveryView("backup");
      setRestorePassword("");
    } catch (err) {
      // The stored backup is only ever read — a wrong password leaves it intact.
      logError("ConnectScreen.restore", err);
      setRestoreNotice("That password didn’t unlock this backup. Check it and try again.");
    } finally {
      setRestoreBusy(false);
    }
  };

  // Auto-resume: on reload/connect, if a backup exists for this wallet and no
  // live session is present, prompt for the password (never auto-restore).
  useEffect(() => {
    if (!isWallet || !session?.walletAddress) return;
    const address = session.walletAddress;
    if (
      shouldAutoResume({
        hasBackup: hasStoredBackup(address),
        hasCredentials: credentials.length > 0,
        alreadyPrompted: resumePrompted.current,
      })
    ) {
      resumePrompted.current = true;
      openRestorePrompt("resume");
    }
  }, [isWallet, session, credentials.length, openRestorePrompt]);

  return (
    <div className="screen">
      <div className="screen-header">
        <p className="page-context">Account &amp; workout access</p>
        <h1 className="screen-title">Your private athlete identity</h1>
        <p className="screen-sub">
          Your wallet funds transactions but does not identify you on-chain. Strava provides a real
          workout; WitnessFitness turns it into a sealed credential for wagers and streaks.
        </p>
      </div>

      <div className="grid-2">
        <Card title="Private identity" glow>
          {session ? (
            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>Private athlete</span>
                <Chip tone="provable">pseudonymous on-chain</Chip>
              </div>
              <div className="stat-row" style={{ marginBottom: 14 }}>
                <Stat
                  label="Holder binding (challenge ID)"
                  value={
                    <span className="hash">
                      {hexShort(session.athlete.holderBinding, 12, 10)}{" "}
                      <button
                        type="button"
                        className="copy-id-btn"
                        title="copy challenge ID to share"
                        onClick={() => void handleCopyBinding()}
                      >
                        {copiedId === session.athlete.holderBinding ? "Copied ✓" : "Copy ID"}
                      </button>
                    </span>
                  }
                />
                <Stat label="Mode" value={isWallet ? "wallet (Lace)" : "live (sidecar :8200)"} />
                <Stat label="Backend" value={session.walletLabel} />
              </div>
              {session.walletAddress ? (
                <div className="stat-row" style={{ marginBottom: 14 }}>
                  <Stat
                    label="Funding wallet (local only)"
                    value={<span className="hash">{hexShort(session.walletAddress, 10, 8)}</span>}
                  />
                  <Stat label="Network" value={session.networkId ?? "—"} />
                </div>
              ) : null}
              <div className="divider" />
              <div className="row-between">
                <div style={{ flex: 1 }}>
                  {isWallet ? (
                    strava?.connected ? (
                      <Button
                        tone="seal"
                        onClick={() => void handleAttest()}
                        disabled={attestRunning}
                        block
                      >
                        {attestRunning ? <span className="spin" /> : null}
                        {attestRunning ? "Attesting…" : "Attest workout"}
                      </Button>
                    ) : (
                      <Button
                        tone="seal"
                        onClick={() => handleConnectStrava()}
                        disabled={attestRunning}
                        block
                      >
                        Connect Strava — OAuth
                      </Button>
                    )
                  ) : (
                    <Button
                      tone="seal"
                      onClick={() => void handleAttest()}
                      disabled={attestRunning}
                    >
                      {attestRunning ? <span className="spin" /> : null}
                      {attestRunning ? "Attesting…" : "Connect Strava & attest workout"}
                    </Button>
                  )}
                </div>
                <Chip tone="seal">private by default</Chip>
              </div>
              {isWallet && !strava?.connected ? (
                <div style={{ marginTop: 8 }}>
                  <Notice tone="info">
                    Attestation needs a Strava account: authorize with Strava (the client secret
                    never touches this browser — the stateless service on :8200 exchanges the code),
                    then attest a real workout.
                  </Notice>
                </div>
              ) : null}
              {attestError ? (
                <div style={{ marginTop: 12 }}>
                  <Notice tone="error">{attestError}</Notice>
                </div>
              ) : null}

              {isWallet && backupPrivateState ? (
                <>
                  <div className="divider" />
                  <section className="private-recovery" aria-labelledby="private-recovery-title">
                    <header className="private-recovery__heading">
                      <span className="private-recovery__icon" aria-hidden="true">
                        {recoveryView === "restore" ? <RotateCcw /> : <ShieldCheck />}
                      </span>
                      <div>
                        <h3 id="private-recovery-title">
                          {recoveryView === "restore"
                            ? restoreMode === "resume"
                              ? "Resume your private account"
                              : "Restore private progress"
                            : hasBackup
                              ? "Your private progress is protected"
                              : "Protect your private progress"}
                        </h3>
                        <p>
                          {recoveryView === "restore"
                            ? "Unlock the encrypted backup saved for this wallet. Nothing is uploaded or revealed on-chain."
                            : hasBackup
                              ? "Update your encrypted backup after adding new credentials or changing your private progress."
                              : "Save an encrypted recovery copy of your credentials and holder secret in this browser."}
                        </p>
                      </div>
                    </header>

                    {recoveryView === "backup" ? (
                      <>
                        <form
                          className="private-recovery__form"
                          aria-busy={backupBusy}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleBackup();
                          }}
                        >
                          <div className="field">
                            <label htmlFor="backup-password">
                              {hasBackup ? "New recovery password" : "Create a recovery password"}
                            </label>
                            <input
                              id="backup-password"
                              className="input"
                              type="password"
                              required
                              disabled={backupBusy}
                              autoComplete="new-password"
                              placeholder="Choose a password"
                              aria-describedby="backup-password-help"
                              aria-invalid={backupNotice?.tone === "error"}
                              value={backupPassword}
                              onChange={(event) => {
                                setBackupPassword(event.target.value);
                                setBackupNotice(null);
                              }}
                            />
                            <small id="backup-password-help">
                              You’ll need this password to restore your private state.
                            </small>
                          </div>
                          <Button
                            tone="primary"
                            block
                            type="submit"
                            disabled={backupBusy || !backupPassword}
                          >
                            {backupBusy ? (
                              <span className="spin" />
                            ) : (
                              <KeyRound aria-hidden="true" />
                            )}
                            {backupBusy
                              ? "Saving encrypted backup…"
                              : hasBackup
                                ? "Update encrypted backup"
                                : "Save encrypted backup"}
                          </Button>
                        </form>

                        {backupNotice ? (
                          <div className="private-recovery__notice">
                            <Notice tone={backupNotice.tone}>{backupNotice.message}</Notice>
                          </div>
                        ) : null}

                        <footer className="private-recovery__status">
                          <span>
                            {hasBackup ? "Backup available for this wallet" : "No backup saved yet"}
                          </span>
                          {hasBackup ? (
                            <button
                              type="button"
                              className="text-action private-recovery__switch"
                              onClick={() => openRestorePrompt("restore")}
                            >
                              <RotateCcw aria-hidden="true" /> Restore an existing backup
                            </button>
                          ) : null}
                        </footer>
                      </>
                    ) : (
                      <form
                        className="private-recovery__form"
                        aria-busy={restoreBusy}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleRestore();
                        }}
                      >
                        <div className="field">
                          <label htmlFor="restore-password">Recovery password</label>
                          <input
                            id="restore-password"
                            className="input"
                            type="password"
                            required
                            disabled={restoreBusy}
                            autoComplete="current-password"
                            placeholder="Enter your backup password"
                            aria-describedby={
                              restoreNotice
                                ? "restore-password-help restore-password-error"
                                : "restore-password-help"
                            }
                            aria-invalid={Boolean(restoreNotice)}
                            value={restorePassword}
                            onChange={(event) => {
                              setRestorePassword(event.target.value);
                              setRestoreNotice(null);
                            }}
                          />
                          <small id="restore-password-help">
                            An incorrect password will not overwrite your saved backup.
                          </small>
                        </div>

                        {restoreNotice ? (
                          <div id="restore-password-error">
                            <Notice tone="error">{restoreNotice}</Notice>
                          </div>
                        ) : null}

                        <div className="private-recovery__actions">
                          <Button
                            tone="primary"
                            type="submit"
                            disabled={!restorePassword || restoreBusy}
                          >
                            {restoreBusy ? (
                              <span className="spin" />
                            ) : (
                              <RotateCcw aria-hidden="true" />
                            )}
                            {restoreBusy
                              ? "Restoring…"
                              : restoreMode === "resume"
                                ? "Resume private account"
                                : "Restore private state"}
                          </Button>
                          <Button
                            tone="ghost"
                            disabled={restoreBusy}
                            onClick={() => {
                              setRestoreNotice(null);
                              setRestorePassword("");
                              setRecoveryView("backup");
                            }}
                          >
                            <ArrowLeft aria-hidden="true" /> Back to backup
                          </Button>
                        </div>
                      </form>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="hero muted">
                {isLive
                  ? "Live mode talks to the demo sidecar (packages/api on :8200), which runs the full pipeline: notary collection (2-of-3) → contract submit → vault. No browser wallet required."
                  : "Wallet mode connects a Midnight wallet (Lace / DApp Connector) straight to the contract: your wallet authorizes every transaction, and the private state (holder secret, attestations) is backed up encrypted on this browser."}
              </p>
              {isWallet && wallets.length > 1 ? (
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  {wallets.map((w) => (
                    <button
                      type="button"
                      key={w.rdns}
                      className={pickedRdns === w.rdns ? "wallet-pick selected" : "wallet-pick"}
                      onClick={() => handlePickWallet(w.rdns)}
                      disabled={connecting}
                    >
                      <span className="wallet-pick-name">
                        {w.icon ? (
                          <img
                            src={w.icon}
                            alt=""
                            style={{
                              width: 20,
                              height: 20,
                              marginRight: 8,
                              verticalAlign: "middle",
                            }}
                          />
                        ) : null}
                        {w.name}
                      </span>
                      <span className="wallet-pick-meta">{w.apiVersion}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <Button
                tone="primary"
                block
                onClick={() => void handleConnect()}
                disabled={connecting}
              >
                {connecting ? <span className="spin" /> : null}
                {isLive
                  ? "Connect to demo service"
                  : wallets.length > 1
                    ? "Connect selected wallet"
                    : "Connect wallet"}
              </Button>
              {connecting ? (
                <p className="muted" style={{ marginTop: 8, textAlign: "center" }}>
                  Waiting for wallet approval…
                </p>
              ) : null}
              {connectError ? (
                <div style={{ marginTop: 12 }}>
                  <Notice tone="error">{connectError}</Notice>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card title="Attestation pipeline">
          {attestStages.length > 0 || attestOutcome ? (
            <StatusLine
              stages={attestStages.length > 0 ? attestStages : (attestOutcome?.stages ?? [])}
            />
          ) : (
            <div className="empty-state">
              The pipeline lights up here when an attestation runs: TLS witness → ZK proof → notary
              signing (2-of-3) → on-chain vaulting.
            </div>
          )}
          {outcome ? (
            <div className="credential-result">
              <Notice tone="success">
                <div className="credential-confirmation">
                  <div className="credential-confirmation__heading">
                    <strong>Credential vaulted</strong>
                    <span>Ready for private wagers and streaks.</span>
                  </div>
                  <ul aria-label="Verified workout claims">
                    {outcome.provableChips.map((claim) => (
                      <li key={claim}>{claim}</li>
                    ))}
                  </ul>
                  {attestOutcome?.replayed ? (
                    <small>
                      Demo fallback used; the cryptographic verification path was unchanged.
                    </small>
                  ) : null}
                </div>
              </Notice>
              <div className="divider" />
              <div className="stat-row" style={{ gap: 20 }}>
                <Stat
                  label="Commitment (vault key)"
                  value={<span className="hash">{hexShort(outcome.commitment, 12, 10)}</span>}
                />
                {outcome.txHash ? (
                  <Stat
                    label="Transaction"
                    value={<span className="hash">{hexShort(outcome.txHash, 12, 10)}</span>}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {credentials.length > 0 && !attestOutcome ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="info">
                {credentials.length} sealed credential
                {credentials.length > 1 ? "s" : ""} ready for private wagers and streaks.
              </Notice>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
};
