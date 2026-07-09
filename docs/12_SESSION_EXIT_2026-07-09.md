# Session Exit — 2026-07-09

Handoff for Johnson's Golf. Where the project stands, what shipped this session,
what still needs a human, and what's next.

---

## Snapshot

- **Branch:** `version2` (deploys to GitHub Pages).
- **HEAD:** `921f996` — "Phase 5 — activate Firebase (config, /aces rule, Google link UI)".
- **Tests:** 137 unit/simulation tests (22 vitest files) + 8 Playwright spec
  files (visual + gameplay + perf smokes) — all green. Production build clean.
- **Release tag:** `v1.0.0-rc1` exists **locally only**. The managed git gateway
  returns 403 on tag pushes (branch pushes work), so it isn't on the remote —
  cut it from the GitHub UI on commit `1fe7d89` if you want it published.
- **Status:** feature-complete V1.0 release candidate. All roadmap phases
  (1A–9) are built. Phase 5 (accounts/cloud) is now activated in code and
  awaiting three Firebase-console steps (below) to work end-to-end.

The living technical log is `docs/ARCHITECTURE_REVIEW.md` (top layers, newest
first). This doc is the short version.

---

## What shipped this session

- **Phase 8 — async tournaments + ace challenge** (`src/firebase/Tournaments.ts`,
  UI in `main.ts`). Create a `JG-XXXXXX` event with a shared seed (identical
  wind for all entrants), share a `?t=CODE` link, submit one first-write-wins
  entry at the summary, see live standings. Ace Challenge tees off a par 3 on
  repeat and posts to an all-time `/aces` board. Both degrade to an offline
  notice when Firebase is off.
- **Phase 9 — polish & RC:**
  - Tree collision now actually stops/slows a ball that hits a fairway tree
    (kept descending-only so Wildwood's balance is unchanged).
  - **Two new courses** — **Sable Bay** (coastal, water on all three holes, a
    real island-green par 3) and **Timberline** (forest, tight corridors, a
    tree mid-fairway on Pine Alley). New Course wizard step.
  - **Reset Records** (two-step confirm; clears stats/scores, keeps purchases).
  - **Accessibility:** working sound/ambience volume sliders, reduced-motion
    toggle (suppresses hole-out rumble), colorblind outline on the meter's
    perfect band, 48px touch rows.
  - Perf gate (render-cost baseline), dead-code removal (`Scoring` class),
    README rewrite, `docs/DEVICE_MATRIX.md`.
- **Phase 5 — activated** (see below).

Earlier in the same arc (already on `version2`): the full course-graphics redo
(spline fairways, elevation, materials), Appendix-A balance via seeded
simulation, 1v1/scramble + AI personalities + fire, spin & shotmaking, the
FB1–FB8 playtest-feedback pass, progression, and the gold store.

---

## Phase 5 — remaining human action (Matt)

The code is done and the live `golfgame-9c11e` config is committed. Three
console steps make it work end-to-end (full detail in `docs/FIREBASE_SETUP.md`):

1. **Authentication → Sign-in method** → enable **Anonymous** and **Google**.
2. **Authentication → Settings → Authorized domains** → ensure
   `mjohnsonwellabe.github.io` and `localhost` are present.
3. **Realtime Database → Rules** → paste the block in `FIREBASE_SETUP.md`
   (it now includes the required `aces` rule) → **Publish**.

**Verify:** open the deployed game → Profile → should read "Cloud sync on…" with
a **Link Google account** button. Link it, then link the same Google account on
a second device — coins/level/unlocks carry over.

---

## What's left vs the vision

Cross-referenced against the V1.0 checklist in `docs/05_DEVELOPMENT_ROADMAP.md`.
Everything on that checklist is met **except**:

### Open (buildable next)
1. **Apparel customization** — the vision's Phase 7 lists shirts/dresses/shoes/
   hats/club skins. The store currently ships whole-character unlocks +
   ball/trail tints + club stat upgrades only. **Decision made:** implement as
   **recolor slots** (shirt/bottoms/shoes/hat/club) reusing the ball/trail tint
   pipeline (`StoreEngine`, `equippedColor`, `assembleGolfer`) — no new assets.
   Not yet built.
2. **Tournament history** — live tournaments + standings exist, but there's no
   per-player list of past events/results. Would persist entered codes on
   `PlayerProfile` and add a "My Tournaments" section to the tournaments overlay.
3. **On-device testing** — `docs/DEVICE_MATRIX.md` rows can only be filled on
   real phones (headless CI measures render cost, not true fps).

### Deferred by choice (documented in ARCHITECTURE_REVIEW)
- **`main.ts` split** — it's the ~2.2k-line composition root + `HoleScene` host.
  High-risk, internal-only; flagged as the first tech-debt item next cycle,
  behind the Playwright net, before adding more to the module.
- **A 4th "links" course** — three courses already exceed the two-course bar.

### Declined
- **Email/password login** — Matt chose Anonymous + Google as the shipped set;
  dropped from V1.0 scope.

### Post-1.0 (long-term roadmap, `docs/05`)
Weather, career mode, friends list, replay, practice range, spectator, live
multiplayer, more courses/cosmetics — explicitly future.

---

## How to resume

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 137 unit/simulation tests
npm run shots      # Playwright visual + gameplay + perf specs
npm run build      # type-check + production build
```

Key files for the open work:
- Store/cosmetics: `src/data/storeCatalog.ts`, `src/systems/StoreEngine.ts`,
  `equippedColor`, `assembleGolfer` (`src/data/golfers.ts`), profile cosmetics
  in `src/profile/Profile.ts`.
- Tournaments: `src/firebase/Tournaments.ts` + the overlay in
  `src/slice3d/main.ts`.
- The full active plan (Phase 5 + remaining-gap analysis) is in the plan file
  referenced from the last planning turn; this doc is the durable summary.

## Known caveats
- **Firebase config is committed** in `src/config.ts` — these are public web
  identifiers; security is entirely in the database rules. Standard/safe.
- **Open-rules tournaments/aces** are friends-only trust: any client can post.
  The Phase 5 rules make `profiles` per-user and `tournaments` write-once;
  tightening `aces`/tournament validation further needs authed, uid-keyed rules.
- **Perf** is measured as render cost headless (rAF is throttled when the tab is
  backgrounded); real fps is a device-matrix task.
