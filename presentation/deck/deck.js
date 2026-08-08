const THEME_KEY = "wf-deck-theme";
const ATMOS_KEY = "wf-deck-atmosphere";
const ATMOSPHERES = ["track", "seal", "grain"];

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {}
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
}

function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

function currentAtmosphere() {
  const a = document.documentElement.getAttribute("data-atmosphere");
  return ATMOSPHERES.includes(a) ? a : "track";
}

function setAtmosphere(name) {
  const next = ATMOSPHERES.includes(name) ? name : "track";
  document.documentElement.setAttribute("data-atmosphere", next);
  try {
    localStorage.setItem(ATMOS_KEY, next);
  } catch (_) {}
}

function cycleAtmosphere() {
  const i = ATMOSPHERES.indexOf(currentAtmosphere());
  setAtmosphere(ATMOSPHERES[(i + 1) % ATMOSPHERES.length]);
}

function isEditableTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function wireAppearanceControls() {
  setTheme(currentTheme());
  setAtmosphere(currentAtmosphere());

  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (isEditableTarget(ev.target)) return;
    const key = ev.key;
    if (key === "t" || key === "T" || key === "d" || key === "D") {
      toggleTheme();
      ev.preventDefault();
      return;
    }
    if (key === "g" || key === "G") {
      cycleAtmosphere();
      ev.preventDefault();
    }
  });
}

wireAppearanceControls();

Reveal.initialize({
  width: 1280,
  height: 720,
  margin: 0.07,
  minScale: 0.2,
  maxScale: 1.6,

  hash: true,
  slideNumber: "h.v",
  controls: true,
  controlsTutorial: false,
  progress: true,
  center: false,

  // Reveal applies this as an inline style on the visible slide, which is the
  // only way to make slides flex containers — a stylesheet rule loses to it.
  display: "flex",

  transition: "fade",
  transitionSpeed: "fast",
  backgroundTransition: "none",

  // Vertical stacks are the answer to a question you were asked, never part of
  // the scripted run: Left/Right skip past them, Down descends on demand.
  navigationMode: "default",

  plugins: [],
});
