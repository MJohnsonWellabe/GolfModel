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

The goal of this structure is simple: Claude should always know what the game is, what it is not, which standards are non-negotiable, and what to build next.