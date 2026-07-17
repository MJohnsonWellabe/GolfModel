# Claude Phase Sequence for V2.0

**Status:** ACTIVE PLAN

## How to use this file

Run each phase as a separate Claude Code prompt. Do not ask Claude to implement the entire V2 roadmap in one pass.

For every phase, Claude must first read:

- `docs/README.md`
- `docs/vision/00_EXECUTIVE_VISION.md`
- `docs/vision/01_DESIGN_CONSTITUTION.md`
- `docs/vision/04_V2_MASTER_ROADMAP.md`
- the domain documents relevant to the phase

Each phase should end with code, tests, documentation, performance evidence, known limitations, and a reviewable commit series.

---

## Prompt 0 — Current-build observation package

Ask Claude to create documentation and lightweight tooling for structured real-device playtesting without changing gameplay.

Expected output:

- playtest checklist
- device matrix template
- issue severity rubric
- friction and delight log
- instructions for capturing reproducible performance observations

Do not add game features in this prompt.

---

## Prompt 1 — Development environment design

Ask Claude to inspect the current deployment, Firebase configuration, authentication, GitHub Pages setup, workflows, and admin authorization.

Expected output:

- proposed production/development architecture
- exact file and configuration changes
- Firebase project setup checklist
- access-control design
- data-isolation design
- deployment and rollback workflow
- risks and migration plan

This prompt should primarily design and inventory. Do not implement until the approach is reviewed.

---

## Prompt 2 — Development environment implementation

After reviewing Prompt 1, implement the protected development environment.

Required outcomes:

- separate development deployment
- admin-only access
- explicit environment configuration
- isolated development data
- visible environment badge
- independent analytics
- build and smoke tests
- promotion and rollback documentation

Do not alter the public production deployment during implementation.

---

## Prompt 3 — Development environment validation

Ask Claude to validate the new environment from a production-like build.

Tests should include:

- authorized and unauthorized access
- phone and desktop access
- development writes not reaching production
- production unaffected
- Firebase rule behavior
- missing-config failure
- feature-flag behavior
- deployment rollback rehearsal

Do not proceed until this phase is green.

---

## Prompt 4 — Delight audit and design

Ask Claude to audit camera, transitions, celebrations, loading, UI motion, score reveals, and tactile feedback.

Expected output:

- prioritized polish opportunities
- before-state evidence
- performance risk for each idea
- mobile behavior
- reduced-motion behavior
- phased implementation recommendation

Do not implement every idea during the audit.

---

## Prompt 5 — Delight implementation A: cameras and shot presentation

Implement the highest-value camera and shot-follow improvements.

Requirements:

- maintain ball and landing readability
- preserve input latency
- avoid camera nausea
- support reduced motion
- test all courses and modes
- add disposal and repeat-round coverage

---

## Prompt 6 — Delight implementation B: results and transitions

Polish:

- hole completion
- round completion
- PB and record reveals
- mastery and achievement moments
- Replay and Play Next transitions

Keep primary continuation actions visible and immediate.

---

## Prompt 7 — Character personality bible

Before adding animations, define each character's personality, silhouette, stance, emotional range, celebration style, and animation budget.

Expected output belongs in `docs/content/` and should identify reusable versus unique animation needs.

---

## Prompt 8 — Character personality implementation

Implement personality in a controlled subset first, then validate performance, blending, cancellation, Store presentation, and gameplay interruption risk before expanding to the full roster.

---

## Prompt 9 — Course atmosphere bible

Create a detailed identity and performance plan for Sable Bay, Wildwood, Timberline, and Port Johnson.

Include:

- visual motifs
- ambient sound
- environmental motion
- landmark moments
- time or weather assumptions
- mobile budgets
- quality scaling
- disposal strategy

---

## Prompt 10 — Course atmosphere implementation

Implement one course as the reference pattern. Validate it on target devices and through soak tests before copying the architecture to the other courses.

---

## Prompt 11 — Audio identity audit and library plan

Inventory current audio, normalization, caching, overlap behavior, ambient loops, mute handling, and missing surface feedback.

Design a coherent category and mixing system before adding many files.

---

## Prompt 12 — Audio implementation

Add controlled variation for impacts, surfaces, cup, UI, characters, and ambience. Preserve one centralized effective audio preference and guarantee no muted startup leak.

---

## Prompt 13 — Juice pass

Implement only feedback that improves communication or celebration. Evaluate camera punch, trails, particles, flag and cup response, Fire Mode treatment, and optional haptics.

Reject effects that obscure gameplay or harm weaker devices.

---

## Prompt 14 — Live Ops operating model

Review the existing Retention/Live Ops workspace and design the next operational layer:

- scheduling
- preview
- validation
- reward constraints
- audit history
- rollback
- development-to-production promotion

---

## Prompt 15 — Studio module roadmap

Translate `docs/studio/BITE_SIZED_GOLF_STUDIO.md` into a technical architecture and sequenced module backlog. Build only the first approved module after review.

---

## Prompt 16 — Analytics decision framework

Audit existing events and dashboards. Remove or deprecate low-value events, document metric definitions, and ensure unique players, guests, accounts, sessions, rounds, and identity transitions are measured correctly.

---

## Prompt 17 — Content expansion proposal

Only after earlier phases are stable, ask Claude to propose the next content package. The proposal must include gameplay purpose, art direction, atmosphere, mastery, performance budget, authoring requirements, and Live Ops reuse.

Do not automatically implement the proposal.

---

## Standard completion report for every implementation prompt

Claude must report:

1. Summary of changes
2. Files changed
3. Architecture decisions
4. Player-facing behavior
5. Mobile behavior
6. Performance measurements
7. Tests added and results
8. Firebase or deployment actions required
9. Data migration behavior
10. Rollback plan
11. Known limitations
12. Documentation updated
13. Recommended manual playtest

## Stop conditions

Pause the roadmap when:

- production stability is uncertain
- real-device input feel regresses
- resource soak fails
- primary mobile actions require avoidable scrolling
- the new system duplicates an existing source of truth
- Firebase rules or environment isolation are incomplete
- a feature cannot explain its player value

The roadmap should move at the speed of confidence, not the speed of code generation.