// App shell: brand header, mode pill (informational — mode is decided at
// startup: wallet by default, ?mode=live for maintainer debugging), tab
// navigation, screens, and the always-visible notary trust strip.

import { useState } from "react";
import { DemoProvider, useDemo } from "./state/DemoStore";
import { NotaryStrip } from "./components/NotaryStrip";
import { ConnectScreen } from "./screens/ConnectScreen";
import { VaultScreen } from "./screens/VaultScreen";
import { WagersScreen } from "./screens/WagersScreen";
import { StreaksScreen } from "./screens/StreaksScreen";
import { EmployerScreen } from "./screens/EmployerScreen";

type Tab = "connect" | "vault" | "wagers" | "streaks" | "employer";

const TABS: { id: Tab; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "vault", label: "Vault" },
  { id: "wagers", label: "Wagers" },
  { id: "streaks", label: "Streaks & Badges" },
  { id: "employer", label: "Employer Panel" },
];

const Shell = () => {
  const { mode, credentials, wagers, proofs } = useDemo();
  const [tab, setTab] = useState<Tab>("connect");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">WITNESSFITNESS</div>
            <div className="brand-tagline">prove the workout, hide the data</div>
          </div>
        </div>
        <div className="header-right">
          <div
            className="mode-pill"
            title={
              mode === "live"
                ? "Live mode — maintainer debug via the identity sidecar (?mode=live)"
                : "Wallet mode — Lace DApp Connector, direct chain access"
            }
          >
            <span className="dot dot--green" />
            {mode === "live" ? "live mode" : "wallet mode"}
          </div>
        </div>
      </header>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "vault" && credentials.length > 0 ? (
              <span className="tab__count">{credentials.length}</span>
            ) : null}
            {t.id === "wagers" && wagers.length > 0 ? (
              <span className="tab__count">{wagers.length}</span>
            ) : null}
            {t.id === "employer" && proofs.length > 0 ? (
              <span className="tab__count">{proofs.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "connect" ? <ConnectScreen /> : null}
      {tab === "vault" ? <VaultScreen /> : null}
      {tab === "wagers" ? <WagersScreen /> : null}
      {tab === "streaks" ? <StreaksScreen /> : null}
      {tab === "employer" ? <EmployerScreen /> : null}

      <NotaryStrip />
    </div>
  );
};

export function App() {
  return (
    <DemoProvider>
      <Shell />
    </DemoProvider>
  );
}
