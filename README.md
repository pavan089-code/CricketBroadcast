# Cricket Scorecard Overlay

A lightweight cricket scorecard overlay for live streaming (OBS, vMix, Streamlabs, IRL Pro). It
polls the **CricClubs** API for live scores, or runs on mock data for setup and testing.

Live score requests stay same-origin: Vite supplies `/api/cricclubs/match` during local
development, and the first-party Cloudflare Worker supplies it in production. Both generate a
fresh CricClubs `x-content-token` server-side for each upstream request; the browser never calls
`core-prod-origin.cricclubs.com` directly.

**Live at [score.abhinav.dev](https://score.abhinav.dev)** — open it with no parameters to build
your overlay URL, preview any theme, and link a YouTube stream to a match.

> **Looking for *why* something works the way it does?** This README is a usage guide. The
> reasoning, the trade-offs and the traps live in the knowledge bundle at
> **[`docs/`](docs/index.md)**.

---

## Quick start

```bash
npm ci
npm run dev          # http://localhost:5173
```

### Add it to your streaming app

1. Open the site, paste your CricClubs match URL, and click **Connect match**.
2. If the league cannot be discovered, enter its league ID in the connection fallback fields and retry.
3. After validation, choose a theme and optional broadcast settings, then click **Generate OBS URL** and **Copy OBS URL**.
4. Add an OBS **Browser Source**, paste the generated URL, and use **1920 × 1080** or **1280 × 720**. The page background is transparent.

Visiting the site with no `matchId` shows the home page: a URL builder, one-click theme
previews, the Link Live Stream form, and a reference table of every parameter.

---

## URL parameters

| Parameter | Required? | Description | Example |
| :--- | :--- | :--- | :--- |
| `matchId` | **Yes** | The match ID from CricClubs. | `?matchId=1939` |
| `leagueId` | Yes for live scores | Validated CricClubs league/club ID; never guessed. | `?leagueId=12345` |
| `clubId` | No | Backward-compatible alias for `leagueId`. | `?clubId=12345` |
| `theme` | No | Any theme below (default `modern-light`). | `?theme=kkr` |
| `debug` | No | Mock data, `1`–`5`, instead of the live API. | `?debug=1` |
| `mode` | No | `replay` cycles through sample states. | `?mode=replay` |
| `refresh` | No | Poll interval in milliseconds, clamped to 1000–10000 (default 1500). | `?refresh=2000` |
| `quiet` | No | Turns off the event cards; bar only. | `?quiet` |
| `logo` | No | Shows a sponsor logo. | `?logo=1` |
| `data` | No | Draws a small machine-readable code for highlights. Off by default. | `?data=1` |
| `nostats` | No | Opts out of anonymous usage analytics. | `?nostats=1` |

In debug mode, `&card=wicket` (or `milestone`, `partnership`, `four`, `six`) holds a sample
event card so you can position it.

### Debug modes

| | |
|---|---|
| `?debug=1` | first innings |
| `?debug=2` | second innings, chasing |
| `?debug=3` | match ended |
| `?debug=4` | pre-match / toss |
| `?debug=5` | no team logos |

### Themes

Every theme shares one layout; a theme is a palette of colour tokens.

- **Core** — `classic`, `modern-light` (default), `modern-dark`, `neon`
- **IPL franchises** — `kkr`, `rcb`, `mi`, `csk`, `dc`, `rr`, `srh`, `pbks`, `gt`, `lsg`
- **Topguns** — `topguns-light`, `topguns-dark`

The old `modern`, `tel`, `ted`, `tul` and `tud` names still work as aliases.

### Event cards

Moments earn a card that slides in over the batter and bowler slots, holds, and leaves.
Live FOUR, SIX, and WICKET cards are deduplicated by ball ID. Milestone and partnership
cards remain available in the existing legacy sample/replay modes.

| Card | Trigger | Holds |
| :--- | :--- | :--- |
| Wicket | the newest real delivery is a wicket | 8 s |
| Fifty / Hundred | a batter crosses 50 or 100 | 8 s |
| Four / Six | the newest ball is a boundary off the bat | 2 s |
| 50 / 100 partnership | the current stand crosses 50 or 100 | 6 s |

### Machine-readable data code

`?data=1` draws a 66 × 66 px code in the top-left corner carrying the current bar state, so a
recording can be turned into highlights without guessing anything from the picture. It is 0.21%
of the frame and meant to be cropped away. Leave it off unless you are making highlights — see
[`docs/data-code.md`](docs/data-code.md).

---

## Link Live Stream

The home page has a form to attach a YouTube live stream link to a CricClubs match: club ID
(prefilled), match ID, and the YouTube URL.

It opens a small CricClubs window briefly, so **allow pop-ups for this site**. Success means
CricClubs received the request; the public feed can take up to a minute to show it.

---

## Usage analytics

The production site reports a few anonymous events to a first-party endpoint (`/api/collect`, a
Cloudflare Worker in [`worker/`](worker/)) so we can see which matches, themes and streaming apps
use the overlay: `overlay_start`, `home_view` and `link_stream_submit`.

No cookies, no third parties, no persistent identifiers. Nothing is sent from `localhost`,
`?debug=` modes or `?mode=replay`. Add **`?nostats=1`** to opt out; Do Not Track is honoured too.

Details, including what is stored and what deliberately is not, are in
[`docs/analytics.md`](docs/analytics.md).

---

## Highlights

`highlights/` turns a match recording into reels locally — no cloud, no upload, no API keys. It
reads the `?data=1` code out of the recording, or falls back to identifying event cards by
colour for older files.

```bash
cd highlights
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python qrscan.py "/path/match.mp4" -o events.json
.venv/bin/python cut.py   "/path/match.mp4" events.json -o reel.mp4
```

See [`docs/highlights.md`](docs/highlights.md).

---

## Development

The live scorebug (default view or `view=scorebug`) plays transparent FOUR,
SIX and WICKET stingers from `assets/animations/`. `src/eventAnimation.ts` imports
the VP9-alpha WebMs as Vite asset URLs; the production build copies them unchanged
with hashed names. No conversion or eager video preloading is performed.

For manual testing, run `npm run dev`, open `/?debug=1`, and press **4**, **6** or
**W**. These invisible hotkeys are development-only and ignore typing fields,
modified shortcuts and held keys. They are disabled on the setup/full-scorecard
pages and with `?quiet`, which also disables automatic stingers.

Live triggers use only normalized `MatchState.event` values. League, match,
innings and stable delivery ID deduplicate events for the browser tab's session,
including events skipped during playback. Playback is never interrupted or queued;
polling and existing cards continue underneath. The latest qualifying delivery on
the first live poll is eligible, unless the match has ended. Session storage keeps
consumed delivery identities across Browser Source reloads; no scores or player data
are stored. If storage is unavailable, the first snapshot is treated as a baseline
and deduplication continues in memory. Legacy mock/replay fixtures use hotkeys for stinger
testing. Only the newest normalized event from each poll is considered.

Use a 1920×1080 OBS Browser Source. The 60 fps clips play muted once: FOUR 1.80s,
SIX 1.95s, WICKET 2.10s. Compact lower-centre artwork overlays the camera with
true alpha, leaving the scorebug visible. Other aspect ratios use transparent
letterboxing without stretching/cropping. Clips disappear on `ended` or failure.
The score remains visible until playback starts; a 10-second no-progress watchdog
releases stalled playback. Development warnings include the event and asset URL.

The original MP4s remain as source backups; the application only loads the WebMs.
The animation layer is raised 100 pixels at 1920×1080, scaled with the contained
video at other viewport sizes. Review the package in the match's actual OBS scene
before air; no deployment or scene switching is performed by this component.

Live views show a connection warning when updates fail while retaining the last
received score; the warning clears automatically after recovery. Full scoreboard
and full scorecard refer to the same `view=scorecard` view. Unknown `view` values
fall back to the scorebug. Full scorecards require a connected live match URL;
the legacy debug/replay fixtures only render the scorebug.

```bash
npm run test           # watch mode
npm run test:run       # single run (used by the build)
npm run build          # tsc && test:run && vite build -> dist/
npm run preview        # serve the production build
npx tsc                # typecheck only

cd worker              # the CricClubs proxy + analytics Worker
npm run dev            # local Worker + local D1
npm run test:run
npm run typecheck
```

`npm run build` fails on type errors **and** test failures, so run it before opening a PR.

**Deployment**: Netlify builds `master` and serves it at
`https://stupendous-centaur-21db85.netlify.app`. First-party API routes proxy to
the Cloudflare Worker. The Worker that supplies live CricClubs data is deployed manually with
`cd worker && npm run deploy`; see [`docs/deployment.md`](docs/deployment.md) and
[`docs/analytics.md`](docs/analytics.md).

---

## Documentation

| | |
|---|---|
| [`docs/index.md`](docs/index.md) | the knowledge bundle — start here for *why* |
| [`CLAUDE.md`](CLAUDE.md) | ground rules and tripwires for agents working in this repo |

The bundle is an [Open Knowledge Format](docs/index.md) v0.2 base; validate it with
`okflint validate --manifest okf-base.yaml`.

