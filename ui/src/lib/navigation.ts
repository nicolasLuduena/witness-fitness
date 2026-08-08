export type AppRoute = "today" | "wagers" | "streak" | "account";

export const routeFromPath = (path = window.location.pathname): AppRoute => {
  if (path.startsWith("/wagers")) return "wagers";
  if (path.startsWith("/streak")) return "streak";
  if (path.startsWith("/account") || path.startsWith("/setup") || path.startsWith("/strava")) {
    return "account";
  }
  return "today";
};

export const pathForRoute = (route: AppRoute): string => {
  if (route === "today") return "/";
  if (route === "streak") return "/streak";
  return `/${route}`;
};

export const navigateTo = (route: AppRoute): void => {
  const path = pathForRoute(route);
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
};
