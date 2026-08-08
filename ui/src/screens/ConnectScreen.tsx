// Connect — Strava OAuth → live attestation. The "real crypto happening live"
// moment: staged status line (witnessing TLS → notarizing → on-chain).
// Two modes: wallet (Lace DApp Connector — the default) and live (demo
// sidecar :8200, maintainer debug via ?mode=live).

import { useEffect, useRef, useState } from 'react';
import { useDemo } from '../state/DemoStore';
import { Button, Card, Chip, Notice, Stat } from '../components/bits';
import { StatusLine } from '../components/StatusLine';
import { EMPLOYER } from '../domain/story';
import { hexShort } from '../lib/format';
import { discoverWalletSummaries, type WalletSummary } from '../lib/wallet-connector';
import { hasStoredBackup, performRestore, shouldAutoResume, storeBackupPayload, walletBackupKey } from '../lib/wallet-restore';
import { logError } from '../lib/logger';

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
    attestOutcome,
    credentials,
    backupPrivateState,
    restorePrivateState,
  } = useDemo();
  const [attestError, setAttestError] = useState<string | null>(null);
  const [strava, setStrava] = useState<{ connected: boolean; athleteName?: string } | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPayload, setBackupPayload] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'restore' | 'resume'>('restore');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const resumePrompted = useRef(false);
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [pickedRdns, setPickedRdns] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isWallet = mode === 'wallet';
  const isLive = mode === 'live';
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
      logError('ConnectScreen.copyBinding', err);
      setAttestError('clipboard unavailable');
    }
  };

  const handleConnectStrava = () => {
    try {
      client.connectStrava?.();
    } catch (err) {
      logError('ConnectScreen.stravaRedirect', err);
      setAttestError(err instanceof Error ? err.message : 'strava oauth failed');
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
        logError('ConnectScreen.stravaCallback', err);
        setAttestError(err instanceof Error ? err.message : 'strava oauth failed');
      }
    })();
    setStrava(client.stravaStatus?.() ?? null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWallet, session?.walletAddress]);

  const handleAttest = async () => {
    setAttestError(null);
    try {
      await attest();
      setStrava(client.stravaStatus?.() ?? null);
    } catch (err) {
      logError('ConnectScreen.attest', err);
      setAttestError(err instanceof Error ? err.message : 'attestation failed');
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
      storeBackupPayload(session?.walletAddress ?? '', payload);
      setBackupPayload(payload);
      setBackupNotice('Private state backed up — the payload is stored in this browser and shown below.');
    } catch (err) {
      logError('ConnectScreen.backup', err);
      setBackupNotice(`Backup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const openRestorePrompt = (mode: 'restore' | 'resume') => {
    setRestoreNotice(null);
    setRestorePassword('');
    setRestoreMode(mode);
    setRestoreOpen(true);
  };

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
      setRestoreNotice('Private state restored — vault is back.');
      setRestoreOpen(false);
      setRestorePassword('');
    } catch (err) {
      // The stored backup is only ever read — a wrong password leaves it intact.
      logError('ConnectScreen.restore', err);
      setRestoreNotice(`Restore failed: ${err instanceof Error ? err.message : 'unknown error'}`);
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
      openRestorePrompt('resume');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWallet, session?.walletAddress, credentials.length]);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Connect — attest a real workout</h1>
        <p className="screen-sub">
          Your workout is witnessed over a real TLS session, proven with ZK, re-signed by{' '}
          <strong>2 of 3 notaries</strong>, and vaulted on-chain. The chain stores a commitment —
          it never sees a single number.
        </p>
      </div>

      <div className="grid-2">
        <Card title="Athlete identity" glow>
          {session ? (
            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>
                  {isWallet && strava?.athleteName ? strava.athleteName : session.athlete.name}
                </span>
                <Chip tone="provable">
                  @{isWallet && strava?.connected ? 'strava-attested' : session.athlete.handle}
                </Chip>
              </div>
              <div className="stat-row" style={{ marginBottom: 14 }}>
                <Stat
                  label="Holder binding (challenge ID)"
                  value={
                    <span className="hash">
                      {hexShort(session.athlete.holderBinding, 12, 10)}{' '}
                      <button
                        className="copy-id-btn"
                        title="copy challenge ID to share"
                        onClick={() => void handleCopyBinding()}
                      >
                        {copiedId === session.athlete.holderBinding ? 'Copied ✓' : 'Copy ID'}
                      </button>
                    </span>
                  }
                />
                <Stat
                  label="Mode"
                  value={isWallet ? 'wallet (Lace)' : 'live (sidecar :8200)'}
                />
                <Stat label="Backend" value={session.walletLabel} />
              </div>
              {session.walletAddress ? (
                <div className="stat-row" style={{ marginBottom: 14 }}>
                  <Stat label="Wallet address" value={<span className="hash">{hexShort(session.walletAddress, 10, 8)}</span>} />
                  <Stat label="Network" value={session.networkId ?? '—'} />
                </div>
              ) : null}
              <div className="divider" />
              <div className="row-between">
                <div style={{ flex: 1 }}>
                  {isWallet ? (
                    strava?.connected ? (
                      <Button tone="seal" onClick={() => void handleAttest()} disabled={attestRunning} block>
                        {attestRunning ? <span className="spin" /> : null}
                        {attestRunning ? 'Attesting…' : 'Attest workout'}
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
                    <Button tone="seal" onClick={() => void handleAttest()} disabled={attestRunning}>
                      {attestRunning ? <span className="spin" /> : null}
                      {attestRunning ? 'Attesting…' : 'Connect Strava & attest workout'}
                    </Button>
                  )}
                </div>
                <Chip tone="seal">private by default</Chip>
              </div>
              {isWallet && !strava?.connected ? (
                <div style={{ marginTop: 8 }}>
                  <Notice tone="info">
                    Attestation needs a Strava account: authorize with Strava (the client secret
                    never touches this browser — the stateless service on :8200 exchanges the
                    code), then attest a real workout.
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
                  <h3 className="card-title">Private-state backup &amp; resume</h3>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      type="password"
                      placeholder="Backup password"
                      value={backupPassword}
                      onChange={(e) => setBackupPassword(e.target.value)}
                      style={{ flex: 1, minWidth: 160 }}
                    />
                    <Button tone="gold" size="sm" onClick={() => void handleBackup()} disabled={backupBusy || !backupPassword}>
                      {backupBusy ? <span className="spin" /> : null} Back up
                    </Button>
                  </div>
                  {backupNotice ? (
                    <div style={{ marginTop: 8 }}>
                      <Notice tone={backupNotice.startsWith('Backup failed') ? 'error' : 'success'}>
                        {backupNotice}
                      </Notice>
                    </div>
                  ) : null}
                  {backupPayload ? (
                    <div style={{ marginTop: 8 }}>
                      <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                        payload (encrypted) — {backupPayload.length} chars
                      </div>
                      <div className="hash" style={{ fontSize: 10.5, lineHeight: 1.4, wordBreak: 'break-all' }}>
                        {backupPayload.slice(0, 180)}…
                      </div>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10 }}>
                    <Button
                      tone="ghost"
                      size="sm"
                      block
                      disabled={!hasBackup || restoreBusy}
                      title={hasBackup ? 'Restore the private state from this browser\u2019s stored backup' : 'no backup stored for this wallet'}
                      onClick={() => openRestorePrompt('restore')}
                    >
                      Restore backup{!hasBackup ? ' — no backup stored for this wallet' : ''}
                    </Button>
                  </div>
                  {restoreOpen ? (
                    <div style={{ marginTop: 12, border: '1px solid var(--hairline-2)', borderRadius: 10, padding: 12 }}>
                      <div className="field">
                        <label>{restoreMode === 'resume' ? 'Enter password to resume' : 'Enter backup password'}</label>
                        <input
                          className="input"
                          type="password"
                          autoFocus
                          value={restorePassword}
                          onChange={(e) => setRestorePassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && restorePassword && !restoreBusy) void handleRestore();
                          }}
                        />
                      </div>
                      <div className="row">
                        <Button
                          tone="primary"
                          size="sm"
                          disabled={!restorePassword || restoreBusy}
                          onClick={() => void handleRestore()}
                        >
                          {restoreBusy ? <span className="spin" /> : null}
                          {restoreMode === 'resume' ? 'Resume' : 'Restore'}
                        </Button>
                        <Button tone="ghost" size="sm" disabled={restoreBusy} onClick={() => setRestoreOpen(false)}>
                          Cancel
                        </Button>
                      </div>
                      {restoreNotice ? (
                        <div style={{ marginTop: 8 }}>
                          <Notice tone={restoreNotice.startsWith('Restore failed') ? 'error' : 'success'}>{restoreNotice}</Notice>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="hero muted">
                {isLive
                  ? 'Live mode talks to the demo sidecar (packages/api on :8200), which runs the full pipeline: notary collection (2-of-3) → contract submit → vault. No browser wallet required.'
                  : 'Wallet mode connects a Midnight wallet (Lace / DApp Connector) straight to the contract: your wallet authorizes every transaction, and the private state (holder secret, attestations) is backed up encrypted on this browser.'}
              </p>
              {isWallet && wallets.length > 1 ? (
                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                  {wallets.map((w) => (
                    <button
                      key={w.rdns}
                      className={pickedRdns === w.rdns ? 'wallet-pick selected' : 'wallet-pick'}
                      onClick={() => handlePickWallet(w.rdns)}
                      disabled={connecting}
                    >
                      <span className="wallet-pick-name">
                        {w.icon ? (
                          <img src={w.icon} alt="" style={{ width: 20, height: 20, marginRight: 8, verticalAlign: 'middle' }} />
                        ) : null}
                        {w.name}
                      </span>
                      <span className="wallet-pick-meta">{w.apiVersion}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <Button tone="primary" block onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? <span className="spin" /> : null}
                {isLive
                  ? 'Connect to demo service'
                  : wallets.length > 1
                    ? 'Connect selected wallet'
                    : 'Connect wallet'}
              </Button>
              {connecting ? (
                <p className="muted" style={{ marginTop: 8, textAlign: 'center' }}>
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
          {attestRunning || attestOutcome ? (
            <StatusLine stages={attestOutcome?.stages ?? runningStages()} />
          ) : (
            <div className="empty-state">
              The pipeline lights up here when an attestation runs: TLS witness → ZK proof →
              notary signing (2-of-3) → on-chain vaulting.
            </div>
          )}
          {outcome ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="success">
                Credential vaulted — <strong>{outcome.provableChips.join(' · ')}</strong>.
                {attestOutcome?.replayed ? ' Session replayed from the attested log (identical crypto path).' : ''}
              </Notice>
              <div className="divider" />
              <div className="stat-row" style={{ gap: 20 }}>
                <Stat label="Commitment (vault key)" value={<span className="hash">{hexShort(outcome.commitment, 12, 10)}</span>} />
                {outcome.txHash ? (
                  <Stat label="Transaction" value={<span className="hash">{hexShort(outcome.txHash, 12, 10)}</span>} />
                ) : null}
              </div>
            </div>
          ) : null}
          {credentials.length > 0 && !attestOutcome ? (
            <div style={{ marginTop: 12 }}>
              <Notice tone="info">
                {credentials.length} credential{credentials.length > 1 ? 's' : ''} already vaulted —
                see the Vault tab.
              </Notice>
            </div>
          ) : null}
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Notice tone="info">
          <strong>Who is the employer?</strong> Later, a third party ({EMPLOYER.name}) verifies your
          feats via <code className="mono">proveBadge</code> — the streak data stays sealed. That is
          the Streaks &amp; Badges tab.
        </Notice>
      </div>
    </div>
  );
};

const runningStages = () => [
  { id: 'guard', label: 'Strava account check', detail: 'real API check — no fabricated data', state: 'active' as const },
  { id: 'tls', label: 'Witnessing TLS session', detail: 'attestor-core tunnels to www.strava.com', state: 'pending' as const },
  { id: 'proof', label: 'ZK proof generated', detail: 'extracted parameters committed (stwo)', state: 'pending' as const },
  { id: 'notarize', label: 'Notarizing — 2 of 3 keys', detail: 'independent verification + Schnorr signing', state: 'pending' as const },
  { id: 'chain', label: 'Vaulting on-chain', detail: 'persistentCommit stored', state: 'pending' as const },
];
