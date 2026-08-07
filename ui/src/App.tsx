// App shell: brand header, mode pill, tab navigation, screens, and the
// always-visible notary trust strip.

import { useState } from 'react';
import { DemoProvider, useDemo } from './state/DemoStore';
import { NotaryStrip } from './components/NotaryStrip';
import { ConnectScreen } from './screens/ConnectScreen';
import { VaultScreen } from './screens/VaultScreen';
import { WagersScreen } from './screens/WagersScreen';
import { StreaksScreen } from './screens/StreaksScreen';
import { EmployerScreen } from './screens/EmployerScreen';

type Tab = 'connect' | 'vault' | 'wagers' | 'streaks' | 'employer';

const TABS: { id: Tab; label: string }[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'vault', label: 'Vault' },
  { id: 'wagers', label: 'Wagers' },
  { id: 'streaks', label: 'Streaks & Badges' },
  { id: 'employer', label: 'Employer Panel' },
];

const Shell = () => {
  const { mode, credentials, wagers, proofs } = useDemo();
  const [tab, setTab] = useState<Tab>('connect');

  const switchMode = (next: 'fixture' | 'live' | 'wallet') => {
    const url = new URL(window.location.href);
    if (next === 'fixture') url.searchParams.delete('mode');
    else url.searchParams.set('mode', next);
    window.location.href = url.toString();
  };

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
              mode === 'fixture'
                ? 'Demo mode — offline, deterministic'
                : mode === 'live'
                  ? 'Live mode — notary API + devnet chain via the sidecar'
                  : 'Wallet mode — Lace DApp Connector, direct chain access'
            }
          >
            <span className={`dot ${mode === 'fixture' ? 'dot--amber' : 'dot--green'}`} />
            {mode === 'fixture' ? 'demo mode' : mode === 'live' ? 'live mode' : 'wallet mode'}
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => switchMode(mode === 'fixture' ? 'live' : 'fixture')}
            title={
              mode === 'fixture'
                ? 'Switch to live: notary API + contract'
                : mode === 'wallet'
                  ? 'Switch to offline demo mode'
                  : 'Switch to offline demo mode'
            }
          >
            {mode === 'fixture' ? '→ live' : '→ demo'}
          </button>
          {mode !== 'wallet' ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => switchMode('wallet')}
              title="Wallet mode: connect Lace and sign transactions directly"
            >
              → wallet
            </button>
          ) : null}
        </div>
      </header>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'vault' && credentials.length > 0 ? (
              <span className="tab__count">{credentials.length}</span>
            ) : null}
            {t.id === 'wagers' && wagers.length > 0 ? <span className="tab__count">{wagers.length}</span> : null}
            {t.id === 'employer' && proofs.length > 0 ? <span className="tab__count">{proofs.length}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'connect' ? <ConnectScreen /> : null}
      {tab === 'vault' ? <VaultScreen /> : null}
      {tab === 'wagers' ? <WagersScreen /> : null}
      {tab === 'streaks' ? <StreaksScreen /> : null}
      {tab === 'employer' ? <EmployerScreen /> : null}

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
