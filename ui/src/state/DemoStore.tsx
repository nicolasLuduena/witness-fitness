import { logError } from "../lib/logger";
// Demo state store: the single source of truth for all screens. Wraps the
// WfClient (fixture or live) and holds the UI-facing slices: session,
// credentials, wagers, streak, badges, proofs, notary strip, and the
// settle-reveal beat state.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DemoMode } from "../config";
import { INITIAL_MODE } from "../config";
import type {
  AttestedCredential,
  AttestationStage,
  AttestOutcome,
  BadgeProof,
  BadgeView,
  ClientSession,
  NotaryInfo,
  StreakView,
  WagerCreateRequest,
  WagerSettleResult,
  WagerView,
} from "../domain/types";
import type { WfClient } from "../lib/wf-client";
import { createWfClient } from "../lib/wf-factory";

export interface DemoState {
  mode: DemoMode;
  client: WfClient;
  session: ClientSession | null;
  connecting: boolean;
  connectError: string | null;

  credentials: AttestedCredential[];
  wagers: WagerView[];
  streak: StreakView | null;
  badges: BadgeView[];
  proofs: BadgeProof[];
  notaries: NotaryInfo[];

  attestRunning: boolean;
  attestStages: AttestationStage[];
  attestOutcome: AttestOutcome | null;
  settleReveal: WagerSettleResult | null;

  connect: (rdns?: string) => Promise<void>;
  attest: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshNotaries: () => Promise<void>;
  createWager: (req: WagerCreateRequest) => Promise<WagerView>;
  acceptWager: (id: number) => Promise<void>;
  submitWorkout: (id: number, credentialId: string) => Promise<void>;
  settleWager: (id: number) => Promise<void>;
  clearSettleReveal: () => void;
  advanceStreak: () => Promise<void>;
  mintBadge: (badgeId: number) => Promise<void>;
  proveBadge: (badgeId: number, verifier: string) => Promise<void>;

  // wallet mode only (optional — undefined on fixture/sidecar modes)
  backupPrivateState?: (password: string) => Promise<string>;
  restorePrivateState?: (password: string, payload: string) => Promise<void>;
  resetPrivateState?: () => Promise<void>;
}

const DemoContext = createContext<DemoState | undefined>(undefined);

export const DemoProvider = ({ children }: { children: ReactNode }) => {
  const client = useMemo(() => createWfClient(INITIAL_MODE), []);
  const mode = client.mode;

  const [session, setSession] = useState<ClientSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<AttestedCredential[]>([]);
  const [wagers, setWagers] = useState<WagerView[]>([]);
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [proofs, setProofs] = useState<BadgeProof[]>([]);
  const [notaries, setNotaries] = useState<NotaryInfo[]>([]);

  const [attestRunning, setAttestRunning] = useState(false);
  const [attestStages, setAttestStages] = useState<AttestationStage[]>([]);
  const [attestOutcome, setAttestOutcome] = useState<AttestOutcome | null>(
    null,
  );
  const [settleReveal, setSettleReveal] = useState<WagerSettleResult | null>(
    null,
  );

  const notaryTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(
    async (force = false) => {
      if (mode === "wallet" && !session && !force) return;
      try {
        const [creds, wgs, strk, bdgs] = await Promise.all([
          client.vault(),
          client.listWagers(),
          client.streak(),
          client.badges(),
        ]);
        setCredentials(creds);
        setWagers(wgs);
        setStreak(strk);
        setBadges(bdgs);
      } catch (err) {
        logError("DemoStore.refresh", err);
      }
    },
    [client, mode, session],
  );

  const refreshNotaries = useCallback(async () => {
    try {
      setNotaries(await client.notaryStatus());
    } catch (err) {
      logError("DemoStore.refreshNotaries", err);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    void refreshNotaries();
    notaryTimer.current = window.setInterval(
      () => void refreshNotaries(),
      3_000,
    );
    return () => {
      if (notaryTimer.current !== undefined)
        window.clearInterval(notaryTimer.current);
    };
  }, [refresh, refreshNotaries]);

  const connect = useCallback(
    async (rdns?: string) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const s = await client.connect(rdns);
        setSession(s);
        await refresh(true);
        await refreshNotaries();
      } catch (err) {
        logError("DemoStore.connect", err);
        setConnectError(
          err instanceof Error ? err.message : "connection failed",
        );
      } finally {
        setConnecting(false);
      }
    },
    [client, refresh, refreshNotaries],
  );

  const attest = useCallback(async () => {
    setAttestRunning(true);
    setAttestOutcome(null);
    setAttestStages([]);
    try {
      const outcome = await client.attest(setAttestStages);
      setAttestOutcome(outcome);
      setAttestStages(outcome.stages);
      await refresh();
      await refreshNotaries();
    } finally {
      setAttestRunning(false);
    }
  }, [client, refresh, refreshNotaries]);

  const createWager = useCallback(
    async (req: WagerCreateRequest) => {
      const wager = await client.createWager(req);
      await refresh();
      return wager;
    },
    [client, refresh],
  );

  const acceptWager = useCallback(
    async (id: number) => {
      await client.acceptWager(id);
      await refresh();
    },
    [client, refresh],
  );

  const submitWorkout = useCallback(
    async (id: number, credentialId: string) => {
      await client.submitWorkout(id, credentialId);
      await refresh();
    },
    [client, refresh],
  );

  const settleWager = useCallback(
    async (id: number) => {
      const result = await client.settleWager(id);
      setSettleReveal(result);
      await refresh();
    },
    [client, refresh],
  );

  const clearSettleReveal = useCallback(() => setSettleReveal(null), []);

  const advanceStreak = useCallback(async () => {
    const s = await client.advanceStreak();
    setStreak(s);
    await refresh();
  }, [client, refresh]);

  const mintBadge = useCallback(
    async (badgeId: number) => {
      await client.mintBadge(badgeId);
      await refresh();
    },
    [client, refresh],
  );

  const proveBadge = useCallback(
    async (badgeId: number, verifier: string) => {
      const proof = await client.proveBadge(badgeId, verifier);
      setProofs((prev) => [proof, ...prev]);
      return;
    },
    [client],
  );

  const backupPrivateState = useCallback(
    (password: string) => {
      if (!client.backupPrivateState)
        return Promise.reject(new Error("not supported in this mode"));
      return client.backupPrivateState(password);
    },
    [client],
  );

  const restorePrivateState = useCallback(
    (password: string, payload: string) => {
      if (!client.restorePrivateState)
        return Promise.reject(new Error("not supported in this mode"));
      return client.restorePrivateState(password, payload);
    },
    [client],
  );

  const resetPrivateState = useCallback(() => {
    if (!client.resetPrivateState)
      return Promise.reject(new Error("not supported in this mode"));
    return client.resetPrivateState();
  }, [client]);

  const value: DemoState = {
    mode,
    client,
    session,
    connecting,
    connectError,
    credentials,
    wagers,
    streak,
    badges,
    proofs,
    notaries,
    attestRunning,
    attestStages,
    attestOutcome,
    settleReveal,
    connect,
    attest,
    refresh,
    refreshNotaries,
    createWager,
    acceptWager,
    submitWorkout,
    settleWager,
    clearSettleReveal,
    advanceStreak,
    mintBadge,
    proveBadge,
    backupPrivateState,
    restorePrivateState,
    resetPrivateState,
  };

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
};

export const useDemo = (): DemoState => {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used within DemoProvider");
  return context;
};
