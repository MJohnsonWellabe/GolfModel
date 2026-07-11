# Johnson's Golf

A mobile-first, browser-based golf game in the spirit of Everybody's Golf /
Hot Shots Golf and the classic Tiger Woods console games.

The game ships in **true 3D** (Babylon.js) at the root URL: pick a course,
mode and golfer, then play a full round with real camera work, elevation you
can read, per-hole wind, shot shaping and a putting break grid. A pure,
engine-agnostic gameplay core (physics, aiming, AI, courses, progression) sits
under the 3D presentation and is exercised head-out by the simulation tests.

**Four 3-hole courses**, each with its own identity and the shared premium look
(lush grass, real turf/sand grain, sculpted bunkers, checkerboard fairways,
two-tone striped greens, genuinely-3D flora, wispy sky):

| Course | Character |
| --- | --- |
| **Wildwood Glen** | Parkland — Bethpage-style: small greens, greenside sand, curving tree-lined holes through dense woods, an island-green par 3, and white-and-pink flower gardens by every green |
| **Sable Bay** | Coastal — water in play on every hole with beach sand lining every shore, and an island-green par 3 |
| **Timberline** | Forest — tight, tree-lined corridors and a tree in the middle of the fairway |
| **Port Johnson Links** | Links — a treeless, windswept ocean coast: tall 3D fescue, huge deep waste bunkers, the sea in play down each hole, and an S-shaped par 5 |

The project's vision, design and roadmap live in [`docs/`](docs/) — start with
[`docs/01_PROJECT_VISION.md`](docs/01_PROJECT_VISION.md). The living technical
review is [`docs/ARCHITECTURE_REVIEW.md`](docs/ARCHITECTURE_REVIEW.md).

## How to play

- **Aim:** drag on the course view — left/right rotates, up/down changes the
  target distance. The aim dots ignore wind and slope, so you read the
  hold-off yourself.
- **Shape the shot:** drag the dot on the strike pad. Right of centre draws
  (right-to-left), left fades, low launches high, high launches low. The shape
  bends the ball's FLIGHT — the aim dots curve to preview the arc.
- **Swing:** tap **SWING** and stop the meter in the perfect band for power and
  accuracy. The perfect band narrows on bad lies and with longer clubs (but not
  off the tee).
- **Spin in flight:** during the slowed ball flight, swipe to add spin — a
  landing kick that breaks the ball toward the swipe as it hits the green. It
  never caps, so keep swiping for more.
- **Putt:** read the break grid and the elevation readout at the aim point;
  pace and slope decide the miss, not luck.
- **Catch fire:** back-to-back perfect swings set you on fire — a wider perfect
  band and a flaming meter until you miss.
- Use ◀ ▶ to change club and **AERIAL** for the overhead planning view (it
  always frames ball-to-green).

### Modes

| Mode | Rules |
| --- | --- |
| Solo | Stroke play over 3 holes |
| 1 v 1 | Stroke play vs an AI rival (JD, Sergio, Phil or Tiger) |
| Scramble | Team up with an AI partner — both hit, play the better ball |
| Tournaments | Async online events: everyone plays one shared-seed round, lowest total wins |
| Ace Challenge | Tee off a par 3 on repeat, chasing an all-time hole-in-one leaderboard |

Play earns **XP, coins, levels and achievements**, plus a rotating **daily
challenge** with a day-streak. Coins buy characters (25 in the roster — 5 free,
the rest unlockable), ball/trail tints, outfit colorways, club skins and
club-upgrade tiers in the **Store** (in-game currency only). Progress is stored
per device and cloud-syncs when Firebase is configured, with a never-lose-progress
merge. A **Reset Records** control in the profile clears stats and scores while
keeping purchases.

## Development

```bash
npm install     # install dependencies
npm run dev     # dev server with hot reload (http://localhost:5173)
npm test        # vitest unit + simulation tests (physics, balance, courses, ...)
npm run shots   # Playwright: screenshots, gameplay smokes, perf baseline
npm run build   # type-check + production build into dist/
npm run preview # serve the production build locally
```

Course look & feel is data-driven: each course JSON includes a `theme` block
(sky, sun, turf/water/sand palette, haze, `peaks`/`sea` backdrop) — see
`src/core/rendering/Theme.ts`. Fairways are authored as centerline-plus-width
ribbons and macro-terrain as elevation control points, both compiled at load
(`src/data/courseLoader.ts`, `src/systems/HeightField.ts`).

## Deployment

Pushing to `version2` runs `.github/workflows/deploy.yml`, which tests, builds
and publishes `dist/` to GitHub Pages. One-time repo setup: **Settings → Pages →
Source: GitHub Actions**. The build output is never committed; `docs/` holds the
design documentation, not the site.

## Project structure

```
index.html                Entry page (mobile viewport, canvas, all overlays + CSS)
vite.config.ts            Vite build → dist/, relative base for Pages
src/config.ts             All gameplay tuning constants
src/core/                 Types, input (aim + strike controls), rendering themes, debug flags
src/slice3d/              The 3D game: main.ts (composition + HoleScene), course3d, golfer3d, meter3d
src/systems/              PhysicsEngine, HeightField, AIController, TurnManager, FireSystem,
                          RoundSimulator, ProgressionEngine, StoreEngine, Scoring
src/data/                 Golfers, opponents, clubs, archetypes, characters,
                          course JSONs, progression + store catalogs
src/profile/              PlayerProfile (localStorage + cloud merge)
src/firebase/             Round history + leaderboard, tournaments + aces, cloud profile (RTDB REST)
src/utils/                Seedable RNG, geometry helpers
assets/ · asset-packs/    Converted glb models + provenance for the raw asset packs
tests/                    vitest unit + simulation suites; tests/visual Playwright specs
docs/                     Design documentation (vision, GDD, art, architecture, roadmap...)
```

## Online features (leaderboard, tournaments, cloud saves)

Every finished round is saved to history and shown under **Records** (top-5 per
course and mode). Out of the box this lives in each device's browser storage.
Shared leaderboards, async tournaments, the all-time ace board and cloud profile
sync all run over one Firebase Realtime Database via REST — no server code.

To connect one, follow [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md): create
a project, enable the Realtime Database, paste the config into `src/config.ts`
(the `databaseURL` is safe to commit — security lives in the rules), and apply
the supplied rules. Until then the online modes degrade to an honest offline
notice and everything else plays device-local. Scores are keyed per course **and**
mode, so scramble rounds never compete with solo rounds.
