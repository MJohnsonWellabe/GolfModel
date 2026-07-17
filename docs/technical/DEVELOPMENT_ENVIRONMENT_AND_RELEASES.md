# Development Environment and Release Strategy

**Status:** ACTIVE PLAN

## Goal

Allow ongoing development and admin-only playtesting while the public game remains stable and available.

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

- Admin can use the development game on mobile and desktop.
- Non-admin access is rejected.
- Development and production data are isolated.
- Environment identity is unmistakable.
- Both environments build and test independently.
- Promotion and rollback are documented and rehearsed.
- Production remains playable throughout development.