# Bite-Sized Golf Studio — Technical Architecture & Module Backlog

**Status:** ACTIVE PLAN (Prompt 15 deliverable; Module 1 completed on this
branch — see "Backlog" below)
**Parent vision:** `BITE_SIZED_GOLF_STUDIO.md` (principles govern; this
document maps them onto the codebase and sequences the work)

## Architectural reality: the Studio already exists in embryo

The admin SPA (`admin.html` → `src/admin/main.ts`) is the Studio shell.
Several vision modules already have working ancestors:

| Vision module | Existing ancestor | State |
|---|---|---|
| 1 — Live Ops workspace | `src/admin/liveOps.ts` + `src/data/liveOpsConfig.ts` + `src/firebase/LiveOpsConfig.ts` | **Complete** (drafts, validation, warnings, schedule preview, conflict detection, publish, rollback, audit) |
| 2 — Store & cosmetic authoring | `src/admin/storeStaging.ts`, `src/admin/seasonPassStaging.ts` | Staging areas exist; publish path & catalog authoring remain |
| 3 — Marketing Manager | `src/admin/marketing.ts` (858 lines, mature) | Largely complete per Module 3 spec |
| 4 — Challenge/tournament templates | `src/systems/AsyncChallenge.ts`, `src/firebase/Tournaments.ts` (player-created) | Admin authoring layer not started |
| 5 — Course metadata & layouts | Course JSON schema (`docs/04_TECHNICAL_ARCHITECTURE.md`), `theme` block incl. the new `atmosphere` key | Data model ready; no admin editor |
| 6 — Visual hole authoring | Screenshot/club-lab harnesses as precursors | Far future |

The architecture therefore is **not a new app**: it is the discipline of
growing `src/admin/` modules that all share one workflow contract.

## The shared workflow contract (every module)

Every Studio module MUST wire these seven stages, reusing the shared
plumbing rather than growing parallel copies (constitution rule 10):

1. **Draft** — private per-surface staging under `/adminDrafts/<key>`
   (`src/firebase/AdminDrafts.ts`, already shared by Live Ops/Store/Season).
2. **Validate** — pure, unit-tested validators in `src/data/*` (blocking
   errors) + `warn*` functions (non-blocking notices). No validator may live
   only inside UI code.
3. **Preview** — render the DRAFT through the same pure resolution functions
   the game uses (e.g. the Live Ops schedule preview calls the game's own
   `dailyChallengeFor`/`weeklyEventFor` + override resolvers), so preview
   can never drift from player reality.
4. **Publish** — versioned write to the public node with `publishedBy`
   stamp; snapshot the prior version to `/<node>Prev`.
5. **Rollback** — one-click republish of the `Prev` snapshot as a new
   version (never a destructive restore).
6. **Audit** — append-only `/adminAudit/<surface>` record: who, when,
   version, counts, action.
7. **Degrade** — the game consumes config through migrate/resolve functions
   with deterministic defaults; absent/invalid config can never block play.

Stages 4–6 are implemented today for Live Ops (`publishLiveOpsConfig`) and
are the template for Store/Season publishing.

## Environment behavior

Until the dev Firebase project exists (deferred human step), all Studio
writes target production nodes gated by admin auth — acceptable because
every surface is draft-first, versioned, and rollback-capable. When the dev
project lands, `src/config/env.ts` already gives every module its
environment identity; the promotion flow becomes: publish in dev → verify in
the dev game → re-publish in prod (a deliberate second action, never a
silent copy). No module may special-case environments in UI code — the env
module is the single seam.

## Data-model rules

- Public config nodes are **resolved, denormalized documents** (fast
  world-reads, no joins); drafts may be richer.
- IDs referenced by config (challenge ids, course ids, item ids) must exist
  in code-defined rosters — validators cross-reference the canonical schema
  (`src/data/*`), never a duplicate list.
- Reward AMOUNTS and completion CONDITIONS stay code-defined (exploit
  boundary, restated from the vision doc). Config selects among approved
  options; it never defines new economics.

## Sequenced backlog

1. **Module 1 completion — Live Ops scheduling/preview** *(done, this
   branch)*: 14-day daily + 6-week weekly effective-schedule preview from
   the draft, override/deterministic provenance marked, plus conflict
   detection (same-day duplicate, past-dated entries). Pure functions +
   tests; rendered in the existing Live Ops page.
2. **Module 2 — Store/Season publish path**: give the existing staging
   areas the stage-4→6 plumbing (versioned publish + Prev snapshot + audit
   trail), with the vision doc's price-band validators (characters 500–1000,
   pals 500) as pure functions. Small, high-value, pattern-copying work.
3. **Module 4 (lite) — Featured-challenge templates**: an admin-authored
   challenge-of-the-week (course + seed + target from approved enums)
   published like Live Ops overrides; player side reuses the async-challenge
   runtime. Requires an economy review of its reward band before build.
4. **Module 5 — Course metadata editor**: display metadata, pin/tee
   selection among AUTHORED alternates, atmosphere preset (`theme.
   atmosphere`) — schema-validated JSON round-trip, no geometry editing.
5. **Module 6 — hole-authoring assistance**: not before V2 exit criteria
   are met; requires geometry versioning design first.

Each backlog item ships only after the one before it is validated in the
dev game (vision: controlled increments).

## Testing bar per module

- Validators/resolvers: unit-tested pure functions (the Live Ops set in
  `tests/liveOpsConfig.test.ts` + `tests/unit/liveOpsSchedule.test.ts` is
  the reference).
- Admin surface: an adminScreens visual spec entry proving the page renders
  and the primary action is reachable.
- Player consumption: at least one test proving the game resolves the
  published shape (and its absence) correctly.
