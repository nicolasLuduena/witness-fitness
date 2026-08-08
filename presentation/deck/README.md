# WitnessFitness deck

Offline reveal.js pitch deck. No CDN at runtime.

## Run

```bash
cd presentation/deck
python3 -m http.server 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Keys

| Key | Action |
|---|---|
| `→` / `Space` | Next horizontal (skips verticals) |
| `↓` / `↑` | Into / out of vertical answers |
| `O` / `Esc` | Overview |
| `F` | Fullscreen |
| `B` / `.` | Blackout (before alt-tab to demo) |
| `T` / `D` | Light ↔ dark theme |
| `G` | Cycle background atmosphere (`track` / `seal` / `grain`) |

Theme and atmosphere persist in `localStorage`.

## Slide map

Horizontal spine + vertical answers. **Horizontal is the spine you present; vertical
is the answer to a question you were asked.** You never press `↓` during the scripted run.

```
1   Logo
2   What it is                  ↓ 2a  Provably real · ↓ 2b What Strava is
3   Competition works
4   Why doesn't this exist?     ↓ 4a  Raw sensors can't be trusted
5   Handoff  → alt-tab to the live demo at localhost:5173
6   Receipts
7   What Midnight does          ↓ 7a  Trust model
8   Sealed is a better game
9   Nobody has built this here
10  Scope
11  Roadmap
12  Who plays, who pays         ↓ 12a Counter-evidence
                                ↓ 12b Sizing, honestly
13  Limits                      ↓ 13a The Strava dependency
14  Close
```

Each slide carries its plan cue time in the top-right corner and its ID in the kicker.

## Optional assets

Drop into `assets/` if you have them (placeholders otherwise):

`strava-feed.png` (2b), `wagers-sealed.png` (5), `qr.png` (14).
