# Development Environment and Release Strategy

**Status:** PARTIALLY IMPLEMENTED (V2 foundation landed; hosting/console steps deferred)

## Goal

Allow ongoing development and admin-only playtesting while the public game remains stable and available.

## Implementation status (V2 code foundation)

The code foundation is in place; nothing here changes production behavior — the
resolver returns the exact production literals on a production hostname.

**Landed:**

- **Environment resolver** — `src/config/env.ts` resolves `prod` vs `dev` from
  the hostname (production hostnames listed in `PROD_HOSTNAMES`), with a
  `?env=dev` / `?env=prod` override. It returns a validated `EnvConfig`
  (Firebase identifiers, env name, analytics namespace, admin path, log level)
  and throws on a partially configured dev project. `src/config.ts` re-exports
  `LEADERBOARD_URL` / `FIREBASE` from it, so every existing read site is
  unchanged.
- **Data isolation via local-only dev** — until a separate dev Firebase project
  is configured, development runs LOCAL-ONLY: an empty Firebase `apiKey` keeps
  the whole auth/cloud layer dormant and an empty leaderboard URL makes every
  REST transport a no-op. Development therefore *cannot* write to production
  data. This is the documented transitional strategy (chosen over a
  same-project `dev/` namespace because it needs no path retrofit and removes
  any chance of a stray production write). Set the `VITE_DEV_FIREBASE_*` build
  variables to point development at a real dev project instead.
- **Feature flags** — `src/core/flags.ts`: a registry with per-environment
  defaults, each flag declaring owner + removal condition. Admins (and dev) may
  override via `?ff.<key>=on|off` or `localStorage`; normal production players
  always get the default.
- **Environment badge** — `src/core/envBadge.ts` injects an unmistakable `DEV`
  badge (with the build label) outside production; a no-op on the live site and
  suppressed during screenshot captures. Mounted on the game, admin, and
  marketing pages.
- **Build stamp** — `vite.config.ts` injects app version + git SHA + build time
  (`src/core/buildInfo.ts`); surfaced in the admin footer and the dev badge for
  support.
- **Dev build workflow (dormant)** — `.github/workflows/deploy-dev.yml` builds
  and tests on `develop` / manual dispatch and uploads a downloadable artifact.
  It can never run on `version2` and publishes nowhere by default.

**Deferred human steps (none block the game staying up):**

1. Create a separate **dev Firebase project**; add its public config as the
   repo secrets `DEV_FIREBASE_*` (the dev workflow already forwards them to the
   build as `VITE_DEV_FIREBASE_*`).
2. Choose a **dev hosting target** (a second Pages site in another repo,
   Netlify, or Firebase Hosting on the dev project — a single repo can host only
   one Pages site, which production owns) and add the guarded publish step to
   `deploy-dev.yml`.
3. Point a **dev subdomain / DNS** at that target.
4. Establish the permanent **branch structure** (`develop` alongside
   `version2`).

**Still to build in code (documented follow-up, not required for the polish
work):** the minimal-auth shell that authorizes a dev tester before loading the
game, and the development test-data controls (grant coins, reset mastery,
simulate dates) behind the `devTools` flag — that flag is additionally
hard-gated to non-prod at its consumption site.

## Required environments

### Production

- Public URL
- Production Firebase project and data
- Stable, approved releases only
- Production analytics
- Production admin allowlist
- No experimental flags enabled by default

### Development

- Separate deployment URL
- Separate Firebase project strongly preferred
- Separate analytics and event data
- Admin-only access
- Obvious environment badge
- Safe test users and test economy
- Experimental features allowed behind explicit flags

## Access control

Development access must be enforced, not merely hidden.

Recommended flow:

1. Load only the minimal authentication shell.
2. Authenticate the user.
3. Check development authorization using the development backend.
4. Load the game only for an approved administrator or tester.
5. Show a clear denied screen otherwise.

Do not rely on an obscure URL as access control. Do not expose privileged development data in the initial public bundle when avoidable.

## Configuration model

Use explicit environment configuration with validated required values, including:

- Firebase identifiers
- deployment environment name
- analytics namespace
- feature-flag defaults
- admin collection or path
- logging level
- asset base path where required

The build should fail clearly when required environment configuration is missing. No production secret or identifier should be copied casually into development setup.

## Data isolation

Development must not write to production:

- player profiles
- guest analytics
- leaderboards
- Weekly results
- events
- Live Ops configuration
- Store staging
- marketing configuration
- admin audit history

A separate Firebase project is the clearest approach. If a temporary namespace strategy is used, it must be documented as transitional and protected by rules.

## Branch strategy

Recommended long-term branches:

- `version2` — production source branch
- `develop` — integrated development branch
- short-lived `feature/...` branches — individual work
- optional `release/...` branch — final stabilization when needed

Current migration work may continue on the existing Claude branch until reviewed, then establish the permanent structure intentionally.

## Deployment strategy

### Development deployment

Triggered from the development branch or manually through a protected workflow. It should publish to a stable development URL that can be opened on a phone.

### Production deployment

Triggered only from the approved production branch after all release gates pass. Prefer protected workflow approval if available.

## Promotion checklist

Before production promotion:

- automated tests green
- performance gates green
- production build successful
- development Firebase rules validated
- production Firebase rules reviewed
- manual mobile playtest completed
- Replay and Play Next soak completed
- sound, settings, guest tracking, Store, Daily, Weekly, and admin smoke-tested
- migrations documented
- rollback point recorded
- release notes written

## Rollback

Every production release must identify:

- previous known-good commit
- previous compatible rules/configuration
- whether data migrations are backward compatible
- how to disable the feature using configuration where possible
- how to restore the prior deployment

Avoid destructive migrations without a staged compatibility period.

## Feature flags

Feature flags are useful for incomplete or high-risk systems, but should not become permanent clutter.

Each flag needs:

- owner
- default by environment
- expiration or removal condition
- analytics implications
- fallback behavior

## Development test data

Provide controlled ways to:

- grant coins
- reset mastery and achievements
- create guest sessions
- create test accounts
- simulate Daily and Weekly dates
- seed leaderboard states
- preview Store and Live Ops content

These controls must never be available to normal production players.

## Asset licensing note (promoted from the 2026-07-08 audit)

Purchased asset-pack source archives (e.g. CGTrader packs under
`asset-packs/`) must not be redistributed through the public GitHub Pages
deployment in raw source form. Keep raw purchased archives out of the public
repo or move them to private storage; ship only the curated, converted assets
the game actually uses. Each pack keeps a provenance README. Review this
before the next release.

## Definition of done for Phase 1

- Development and production data are isolated. — **Done** (dev is local-only
  until a dev project exists; it cannot write to production).
- Environment identity is unmistakable. — **Done** (DEV badge + build stamp).
- Configuration is environment-resolved and validated. — **Done**
  (`src/config/env.ts`).
- Production remains playable throughout development. — **Done** (resolver
  returns the live literals on production hostnames; no production path changed).
- Both environments build and test independently. — **Partial** (production
  `deploy.yml` unchanged; `deploy-dev.yml` builds/tests on `develop` but does
  not publish until a dev host is chosen).
- Admin can use the development game on mobile and desktop. — **Deferred**
  (needs the dev hosting target above).
- Non-admin access is rejected. — **Deferred** (minimal-auth dev shell is the
  documented code follow-up; the admin allowlist + `devTools` gating are in
  place as the seam).
- Promotion and rollback are documented and rehearsed. — Documented above;
  rehearsal pending the dev host.