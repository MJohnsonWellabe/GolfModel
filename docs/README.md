# Bite-Sized Golf Documentation

This folder is the authoritative product, design, technical, and roadmap library for Bite-Sized Golf.

## How Claude should use these docs

Before proposing or implementing work:

1. Read `vision/00_EXECUTIVE_VISION.md`.
2. Read `vision/01_DESIGN_CONSTITUTION.md`.
3. Read the relevant domain document.
4. Read the current phase in `roadmap/`.
5. Preserve production stability and the performance gates.

When documents conflict, use this precedence order:

1. Executive vision
2. Design constitution
3. Current V2 roadmap
4. Current domain specifications
5. Historical implementation records
6. Archived documents

## Folder map

- `vision/` — product identity, philosophy, player promise, and V2 roadmap
- `gameplay/` — gameplay pillars and rules that must remain coherent
- `content/` — courses, characters, cosmetics, progression, and Live Ops
- `ux/` — mobile-first interaction and interface standards
- `technical/` — architecture, environments, performance, analytics, and release gates
- `studio/` — internal authoring and administrative tools
- `roadmap/` — phased execution plans intended for separate Claude prompts
- `archive/` — superseded or historical documents retained for reference

## Documentation status labels

Each major document should use one of these states:

- **AUTHORITATIVE** — current source of truth
- **ACTIVE PLAN** — approved direction, not fully implemented
- **IMPLEMENTATION RECORD** — description of completed work
- **HISTORICAL** — retained context, not governing guidance
- **DRAFT** — under review

## Documentation maintenance rules

- Do not create a new overlapping document when an authoritative document can be updated.
- Archive superseded documents rather than deleting valuable history.
- Keep implementation details out of high-level vision files unless they define a non-negotiable product constraint.
- Every major system should identify its owner document.
- New phases should include acceptance criteria, tests, rollback expectations, and documentation updates.

## Current governing set

- `vision/00_EXECUTIVE_VISION.md`
- `vision/01_DESIGN_CONSTITUTION.md`
- `vision/02_PRODUCT_PHILOSOPHY.md`
- `vision/03_PLAYER_EXPERIENCE.md`
- `vision/04_V2_MASTER_ROADMAP.md`
- `technical/DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md`
- `technical/PERFORMANCE_AND_QUALITY_GATES.md`
- `ux/MOBILE_UI_UX_PRINCIPLES.md`
- `content/CONTENT_AND_LIVEOPS_STRATEGY.md`
- `studio/BITE_SIZED_GOLF_STUDIO.md`
- `roadmap/CLAUDE_PHASE_SEQUENCE.md`

## Retained domain and record documents (reconciled 2026-07-17)

Domain specifications (AUTHORITATIVE for their domain, subordinate to the
governing set above; each carries reconciliation notes where the old text
lagged current policy):

- `02_GAME_DESIGN_DOCUMENT.md` — gameplay systems, physics tuning (Appendix A)
- `03_ART_DIRECTION.md` — art, camera, and course visual identity
- `04_TECHNICAL_ARCHITECTURE.md` — architecture and course-authoring schema
- `08_LIVE_SERVICE_AND_PROGRESSION.md` — accounts, progression, Season Pass
- `10_COURSE_DESIGN_BIBLE.md` — course/hole authoring (incl. mastery stars)
- `gameplay/CORE_GAMEPLAY_PILLARS.md` — gameplay feel protections
- `content/CHARACTER_PERSONALITY_BIBLE.md` — who each character is (V2 Phase 3)
- `content/COURSE_ATMOSPHERE_BIBLE.md` — per-course ambient identity (V2 Phase 4)
- `technical/ANALYTICS_FRAMEWORK.md` — event registry + metric definitions (V2 Prompt 16)
- `studio/STUDIO_TECHNICAL_ARCHITECTURE.md` — Studio module map + backlog (V2 Prompt 15)

Active operational runbooks (do not archive):

- `FIREBASE_SETUP.md` — authoritative RTDB rules + console steps
- `15_DEPLOY_BSGOLF_FUN.md` — production deployment + DNS + rollback
- `16_PAYMENTS.md` — Stripe products and fulfillment
- `DEVICE_MATRIX.md` — real-device test matrix
- `visual-bar.md` — course presentation acceptance checks
- `17_MARKETING_PLAN.md` — go-to-market plan

Implementation records (evidence, not governing guidance):

- `20_V1_FINAL_UX_ADMIN_PASS.md`
- `21_RETENTION_AND_PERFORMANCE_PASS.md`
- `22_V2_DELIGHT_AUDIT.md` (V2 Prompts 4–6 + 13)
- `23_V2_AUDIO_IDENTITY.md` (V2 Prompts 11–12)
- `03B_REFERENCE_GUIDE.md` (creative reference)

Proposals awaiting approval (not building yet):

- `24_CONTENT_EXPANSION_PROPOSAL.md` (V2 Prompt 17 — Red Hollow + Wild Prairie + alternate layouts)

Everything else from the old numbered set now lives under `archive/`
(superseded-design, release-plans, implementation-history) with retirement
banners. Notable decisions recorded during reconciliation: the shipped club
stat upgrades are a grandfathered exception (constitution rule 8), and the
Google Play native-build runbook is archived as deferred pending separate
approval.

The goal of this structure is simple: Claude should always know what the game is, what it is not, which standards are non-negotiable, and what to build next.