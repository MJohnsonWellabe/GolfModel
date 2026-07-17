# Bite-Sized Golf Studio

**Status:** ACTIVE PLAN

## Vision

The Bite-Sized Golf Studio is the long-term internal authoring environment for operating and expanding the game without requiring a code change for every piece of content.

It is not one giant editor to build all at once. It should grow in controlled modules that solve recurring operational work.

## Principles

- Admin only
- Development first
- Draft before publish
- Strong validation
- Preview the real player experience
- Audit every production change
- Roll back safely
- Keep exploit-sensitive formulas in code
- Reuse canonical game schemas
- Never create an admin setting that the public game ignores

## Module roadmap

### Module 1 — Live Ops workspace

Author and manage:

- Daily overrides
- Weekly Featured configuration
- featured course and mode
- event dates
- approved rewards
- landing-card copy

Required workflow:

- draft
- schema validation
- conflict detection
- development preview
- publish
- rollback
- audit history

### Module 2 — Store and cosmetic authoring

Manage:

- character records
- Pal records
- cosmetic records
- prices
- rarity
- availability windows
- preview assets
- ownership behavior

Validation must enforce:

- characters cost 500–1,000 coins
- Pals cost 500 coins unless explicitly free/granted
- no duplicate identifiers
- valid assets
- valid dates
- no accidental repurchase of owned items

### Module 3 — Marketing Manager

Manage every public marketing surface that is intended to be configurable, including Fire Mode and True Vision imagery.

Required behavior:

- current published value
- draft replacement
- committed-asset selection
- alt text
- mobile preview
- broken-path prevention
- revert to published
- confirmation that the public page consumes the configured value

Maintain an audit of intentionally hardcoded imagery.

### Module 4 — Challenge and tournament templates

Author reusable challenge definitions from approved building blocks:

- course and hole selection
- wind or seed rules
- mode
- target score
- mastery condition
- eligibility
- reward band
- leaderboard behavior

Do not allow arbitrary executable logic from admin input.

### Module 5 — Course metadata and alternate layouts

Manage safe data-driven course elements:

- display metadata
- tee selection
- pin selection
- featured route
- challenge metadata
- atmosphere preset
- supported Daily/Weekly configurations

This is not yet a freeform geometry editor.

### Module 6 — Visual hole authoring assistance

Later, provide constrained tools for:

- placing tees and pins
- adjusting hazard or target markers
- authoring camera anchors
- setting atmosphere zones
- validating playable paths
- previewing device budgets

Any geometry-writing tool requires strong versioning and rollback.

## Roles and permissions

Initially, one admin role may be sufficient. The data model should not prevent later separation of:

- viewer
- editor
- publisher
- super-admin

Publishing to production should remain more privileged than drafting.

## Environment behavior

Studio work begins against development data. Production publishing must be an explicit action with environment labeling and confirmation.

Never allow a development preview to silently write production configuration.

## Validation layers

1. Field validation
2. Schema validation
3. Cross-reference validation
4. Asset existence validation
5. Economy and reward validation
6. Date and scheduling validation
7. Player-preview validation
8. Production-conflict validation

## Audit requirements

Record:

- actor
- timestamp
- environment
- document type and identifier
- previous value
- new value
- validation result
- publish or rollback action

## Failure behavior

The public game must degrade safely when Studio configuration is absent or invalid. Use known-good defaults, log the issue, and avoid blocking gameplay.

## Studio quality bar

An admin tool is not complete merely because it writes data. It must make the intended change visible in the real development game, prevent invalid publication, and support recovery.

## Long-term outcome

The Studio becomes the operational moat of Bite-Sized Golf: a small team can create a steady stream of high-quality events, challenges, Store rotations, marketing updates, and eventually course content without destabilizing the core game.