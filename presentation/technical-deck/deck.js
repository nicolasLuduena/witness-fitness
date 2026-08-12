Reveal.initialize({
  width: 1280,
  height: 720,
  margin: 0.055,
  minScale: 0.2,
  maxScale: 1.8,
  hash: true,
  controls: false,
  progress: true,
  slideNumber: false,
  center: false,
  display: "flex",
  transition: "fade",
  transitionSpeed: "fast",
  backgroundTransition: "none",
  plugins: [],
});

const cue = document.querySelector(".cue");
let speakerWindow = null;

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
    return entities[character];
  });
}

function speakerDocument() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>WitnessFitness speaker view</title><style>
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f7f7f2;color:#121417;font-family:system-ui,sans-serif}
    header{position:sticky;top:0;display:flex;justify-content:space-between;padding:18px 24px;background:#145cff;color:white;font:700 14px ui-monospace,monospace;letter-spacing:.06em}
    main{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px}section{min-height:190px;padding:22px;border:2px solid #c7ccd3;background:white}
    h1{margin:0 0 14px;font-size:26px}h2{margin:0 0 14px;color:#145cff;font:700 13px ui-monospace,monospace;text-transform:uppercase}
    p{max-width:68ch;font-size:19px;line-height:1.55;white-space:pre-line}.next{color:#4d5560}footer{padding:0 24px 24px;color:#4d5560;font:13px ui-monospace,monospace}
  </style></head><body><header><span>WITNESSFITNESS · SPEAKER</span><span id="cue"></span></header><main><section><h2>Current</h2><h1 id="title"></h1><p id="notes"></p></section><section class="next"><h2>Next</h2><h1 id="next-title"></h1><p id="next-notes"></p></section></main><footer>Keep this window on the presenter display. It updates as the deck advances.</footer></body></html>`;
}

function speakerData() {
  const current = Reveal.getCurrentSlide();
  const next = Reveal.getSlides()[Reveal.getSlides().indexOf(current) + 1];
  const titleFor = (slide) => slide?.querySelector("h1, h2")?.textContent.trim() ?? "End of deck";
  const notesFor = (slide) => slide?.querySelector("aside.notes")?.textContent.trim() ?? "";
  return {
    cue: current?.dataset.cue ?? "",
    title: titleFor(current),
    notes: notesFor(current),
    nextTitle: titleFor(next),
    nextNotes: notesFor(next),
  };
}

function syncSpeaker() {
  if (!speakerWindow || speakerWindow.closed) return;
  const data = speakerData();
  for (const [id, value] of Object.entries({
    cue: data.cue,
    title: data.title,
    notes: data.notes,
    "next-title": data.nextTitle,
    "next-notes": data.nextNotes,
  })) {
    const element = speakerWindow.document.getElementById(id);
    if (element) element.innerHTML = escapeHtml(value);
  }
}

function openSpeaker() {
  if (speakerWindow && !speakerWindow.closed) {
    speakerWindow.focus();
    return;
  }
  speakerWindow = window.open("", "wf-speaker", "width=1200,height=760");
  if (!speakerWindow) return;
  speakerWindow.document.open();
  speakerWindow.document.write(speakerDocument());
  speakerWindow.document.close();
  syncSpeaker();
}

function syncChrome(event) {
  const slide = event?.currentSlide ?? Reveal.getCurrentSlide();
  if (!slide) return;
  document.documentElement.dataset.stage = slide.dataset.stage ?? "browser";
  if (cue) cue.textContent = slide.dataset.cue ?? "";
  syncSpeaker();
}

Reveal.on("ready", syncChrome);
Reveal.on("slidechanged", syncChrome);
Reveal.addKeyBinding({ keyCode: 83, key: "S", description: "Open speaker notes" }, openSpeaker);
