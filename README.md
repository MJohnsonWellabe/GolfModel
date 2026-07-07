# Johnson's Golf

Johnson's Golf: a mobile-first, browser-based golf game built with **Phaser 3 + TypeScript + Vite**.
Behind-the-player shot presentation with an overhead planning view, in the spirit of classic Tiger Woods and Hot Shots Golf.

Two 3-hole courses — Amen Corner (Augusta's holes 11–13) and Legends Links (island green,
the Road Hole, an ocean finish) — with a classic 3-click swing meter, wind, lies, club
selection and a "catch fire" streak system.

The project's vision, design, and roadmap live in [`docs/`](docs/) — start with
[`docs/01_PROJECT_VISION.md`](docs/01_PROJECT_VISION.md). The current-state technical
review is [`docs/ARCHITECTURE_REVIEW.md`](docs/ARCHITECTURE_REVIEW.md).

## How to play

- **Tap 1** (SWING button): start the swing — the cursor sweeps right.
- **Tap 2**: lock **power** against the right target line.
- **Tap 3**: lock **accuracy** against the left target line as the cursor returns.
- Drag on the course view to aim (left/right rotates, up/down changes distance); use ◀ ▶ (top-left) to change club, AERIAL for the overhead planning view.
- The power target line moves to the power you need for your aim point; on the green, read the break arrows before you putt.
- Two all-perfect swings in a row set you **on fire** — a wider perfect zone and +5 to your stats until you miss.

### Modes

| Mode | Rules |
| --- | --- |
| Solo | Stroke play over 3 holes |
| 1 v 1 | Stroke play vs an AI legend (Tiger, Sergio, Phil or Rory) |
| Scramble | Team up with an AI partner — both hit, play the better ball |

## Development

```bash
npm install     # install dependencies
npm run dev     # dev server with hot reload (http://localhost:5173)
npm test        # vitest unit tests (physics, scoring, turns, ...)
npm run build   # type-check + production build into dist/
npm run preview # serve the production build locally
```

## Deployment

Pushing to `main` or `version2` runs `.github/workflows/deploy.yml`, which tests,
builds, and publishes `dist/` to GitHub Pages. One-time repo setup:
**Settings → Pages → Source: GitHub Actions**. The build output is never committed;
`docs/` holds the design documentation, not the site.

## Project structure

```
index.html              Entry page (mobile viewport, canvas container)
vite.config.ts          Vite build → dist/, relative base for Pages
src/main.ts             Phaser bootstrap
src/config.ts           All gameplay tuning constants
src/scenes/             Title, GolferSelect, ModeSelect, CourseSelect, Game, Results, Records
src/core/               Types, cross-scene state, input (aim control),
                        rendering (mode-7 projection, shot + overhead views), audio
src/systems/            PhysicsEngine, SwingMeter, TurnManager, AIController, FireSystem, Scoring
src/ui/                 Buttons, avatars, in-round HUD
src/firebase/           Round history + shared leaderboard (RTDB REST)
src/data/               Golfers, opponents, clubs, course JSONs
assets/                 UI/sprite SVGs and SFX stubs (Vite public dir)
tests/                  vitest unit tests
docs/                   Design documentation (vision, GDD, art, architecture, roadmap...)
```

## Shared leaderboard (course records)

Every finished round is saved to history and shown under **RECORDS** (course records
and top-5 per course and mode). Out of the box this lives in each device's browser
storage. To share one family leaderboard across all phones (~3 minutes):

1. Go to https://console.firebase.google.com → **Add project** (name it anything,
   Analytics off is fine).
2. In the project: **Build → Realtime Database → Create database** (any location,
   start in *locked mode*).
3. Open the **Rules** tab and replace them with:

   ```json
   {
     "rules": {
       "rounds": {
         ".read": true,
         "$id": { ".write": true, ".validate": "newData.hasChildren(['id','d','course','mode','names','total'])" }
       }
     }
   }
   ```

4. Copy the database URL shown at the top of the Data tab
   (looks like `https://<project>-default-rtdb.firebaseio.com`).
5. Paste it into `LEADERBOARD_URL` in `src/config.ts`, then push — the deploy
   workflow ships it and every phone reads and posts to the same leaderboard.

Scores are keyed per course **and** per mode, so scramble best-ball rounds never
compete with solo rounds. If the database is unreachable the game quietly falls
back to device-local records.
