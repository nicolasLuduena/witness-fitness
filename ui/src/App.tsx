import { Award, CalendarDays, Shield, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { ConnectScreen } from "./screens/ConnectScreen";
import { StreaksScreen } from "./screens/StreaksScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { WagersScreen } from "./screens/WagersScreen";
import { type AppRoute, navigateTo, routeFromPath } from "./lib/navigation";
import { DemoProvider, useDemo } from "./state/DemoStore";

const NAV_ITEMS: { id: AppRoute; label: string; icon: typeof CalendarDays }[] =
  [
    { id: "today", label: "Today", icon: CalendarDays },
    { id: "wagers", label: "Wagers", icon: Trophy },
    { id: "streak", label: "Streak & badges", icon: Award },
  ];

const Shell = () => {
  const { session, credentials } = useDemo();
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath());

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromPath());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const ready = Boolean(session && credentials.length > 0);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => navigateTo("today")}
          aria-label="WitnessFitness home"
        >
          WitnessFitness
        </button>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={
                route === item.id ? "nav-link nav-link--active" : "nav-link"
              }
              onClick={() => navigateTo(item.id)}
              aria-current={route === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className="account-status"
          onClick={() => navigateTo("account")}
        >
          <span
            className={`status-dot ${ready ? "status-dot--ready" : ""}`}
            aria-hidden="true"
          />
          <span>{ready ? "Ready" : "Setup"}</span>
          <Shield aria-hidden="true" />
        </button>
      </header>

      <main id="main-content">
        {route === "today" ? <TodayScreen /> : null}
        {route === "wagers" ? <WagersScreen /> : null}
        {route === "streak" ? <StreaksScreen /> : null}
        {route === "account" ? <ConnectScreen /> : null}
      </main>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={
                route === item.id
                  ? "mobile-nav__item mobile-nav__item--active"
                  : "mobile-nav__item"
              }
              onClick={() => navigateTo(item.id)}
              aria-current={route === item.id ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.id === "streak" ? "Streak" : item.label}</span>
            </button>
          );
        })}
      </nav>
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
