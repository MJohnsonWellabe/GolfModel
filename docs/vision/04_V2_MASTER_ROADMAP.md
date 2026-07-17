# Bite-Sized Golf — V2.0 Master Roadmap

**Status:** ACTIVE PLAN  
**Implementation model:** Run each phase as a separate Claude prompt and branch-reviewed delivery.

## V2 objective

Version 2.0 transforms the current stable game into a premium-feeling, maintainable product with a protected development workflow, stronger presentation, richer personality, data-driven content operations, and scalable internal tools.

V2 is not a mandate to add more permanent mechanics. It is a mandate to improve quality, identity, maintainability, and the pace at which fresh content can be created safely.

---

## Phase 0 — Play, observe, and establish a baseline

Leave the current build unchanged long enough to understand it.

### Work

- Play on multiple real phones and desktop browsers.
- Complete repeated Replay and Play Next cycles.
- Test every course, Daily, Weekly, Store, profile, guest flow, and admin surface.
- Record friction, delight, confusion, visual weakness, audio weakness, and device-specific performance.
- Capture baseline analytics and real-device timings.
- Separate defects from preferences and new ideas.

### Deliverables

- playtest journal
- prioritized issue list
- real-device performance matrix
- screenshots or clips of presentation weaknesses
- list of systems that should remain frozen

### Exit criteria

Do not begin major V2 work until the current build has been played enough to identify the highest-value polish opportunities.

---

## Phase 1 — Permanent development environment

Create an isolated, admin-only environment where future work can be tested while the public production game remains stable.

### Work

- Create explicit development and production runtime configurations.
- Use separate Firebase projects where practical; otherwise use strongly isolated namespaces only as a documented fallback.
- Create a separate development deployment URL.
- Require admin authorization before the development game or development admin surfaces load.
- Keep development analytics, events, leaderboards, Live Ops, and test users separate from production.
- Add visible environment labeling so screenshots and testers cannot confuse builds.
- Add safe promotion and rollback procedures.
- Ensure secrets and environment identifiers are not hardcoded into source.

### Exit criteria

- Public production remains unchanged.
- Admin can open development from phone and desktop.
- Non-admin users cannot access development content.
- Development writes cannot pollute production.
- Automated build and smoke tests run for both configurations.
- Promotion to production is documented and repeatable.

---

## Phase 2 — The Delight Update

Improve perceived quality without changing the fundamental game.

### Focus areas

- camera easing and framing
- shot-follow behavior
- approach and putting emphasis
- result transitions
- menu motion
- score reveals
- achievement and mastery celebrations
- loading and scene transitions
- tactile UI feedback

### Guardrails

- No input latency regressions.
- No large new permanent UI surfaces.
- Effects scale down on weaker devices.
- Reduced-motion settings are respected.
- Celebrations never obstruct Replay or Play Next.

### Exit criteria

The game feels more expensive while remaining equally or more responsive.

---

## Phase 3 — Character personality

Make characters emotionally recognizable and enjoyable to watch.

### Work

- Define personality archetypes for the current roster.
- Add restrained idle animation and stance variation.
- Add shot anticipation, success, near-miss, failure, and victory reactions.
- Add character-specific celebration selection.
- Improve menu and Store presentation.
- Ensure animations cancel and blend correctly during rapid navigation.

### Guardrails

- Personality is cosmetic only.
- Reactions remain brief.
- Animation assets are compressed and reused intelligently.
- Character work may not delay shot input or results navigation.

---

## Phase 4 — Course atmosphere

Make every course identifiable by sight and sound.

### Sable Bay

Waves, gulls, palm movement, distant boats, coastal light, and ocean ambience.

### Wildwood

Birds, insects, leaves, forest depth, light shafts, and woodland ambience.

### Timberline

Mountain wind, pine movement, distant wildlife, elevation mood, and alpine ambience.

### Port Johnson

Surf, fog, lighthouse behavior, harbor details, distant horn, and shoreline ambience.

### Technical expectations

- Atmosphere uses pooled or shared systems.
- Activity pauses appropriately when hidden.
- Audio respects the global setting.
- Effects have device-quality tiers.
- Atmospheric systems are covered by repeat-round disposal tests.

---

## Phase 5 — Audio identity

Move from functional audio to a coherent soundscape.

### Work

- Create controlled variation for club impacts.
- Differentiate fairway, rough, bunker, green, tree, structure, and cup results.
- Improve UI confirmation sounds.
- Add restrained crowd or character response layers.
- Add distinct ambient beds for each course.
- Normalize loudness and prevent clipping.
- Preserve centralized mute and volume behavior.

### Exit criteria

The game remains understandable while muted and feels richer when sound is enabled.

---

## Phase 6 — Responsive “juice” pass

Add subtle feedback that reinforces execution.

### Candidates

- minimal camera punch on strong contact
- refined ball trails
- Fire Mode treatment
- perfect-impact particles
- cup and flag response
- result-count timing
- haptics where supported and permitted

### Rule

Juice must communicate or celebrate. It may not obscure the ball, alter timing perception, or become visual noise.

---

## Phase 7 — Live content operating model

Shift ongoing freshness from code features to authored content.

### Work

- Formalize Daily and Weekly content templates.
- Create seasonal calendars.
- Add featured course, mode, character, cosmetic, and challenge slots.
- Define event reward limits and economy review requirements.
- Create preview, validation, scheduling, publishing, rollback, and audit history.
- Keep reward formulas code-governed where exploitation risk requires it.

### Exit criteria

A normal featured week can be configured without a game-code release.

---

## Phase 8 — Bite-Sized Golf Studio

Build the internal content platform described in `studio/BITE_SIZED_GOLF_STUDIO.md`.

### Progressive scope

1. Validated Live Ops configuration
2. Store and cosmetic authoring
3. Challenge and tournament templates
4. Course metadata and alternate layouts
5. Visual hole authoring assistance
6. Full publish, rollback, and audit workflows

The Studio must grow in controlled increments. Do not attempt a complete general-purpose level editor in one phase.

---

## Phase 9 — Analytics-driven tuning

Use real behavior to prioritize work.

### Primary metrics

- round-start to round-complete rate
- next-round conversion
- Replay versus Play Next selection
- rounds per session
- guest versus signed-in behavior
- D1 and D7 return rates
- course and hole abandonment
- Daily and Weekly participation
- challenge completion and improvement
- Store views, purchase attempts, and successful purchases
- performance by device class

### Rules

- Define the decision each metric supports.
- Avoid collecting sensitive or unnecessary data.
- Keep analytics off critical gameplay paths.
- Distinguish unique players, sessions, and rounds.
- Prevent guest-to-account double counting.

---

## Phase 10 — Selective content expansion

Only after polish and tooling are working.

### Candidate content

- new three-hole courses
- alternate tee and pin layouts
- new mastery challenges
- new characters and Pals
- themed cosmetic collections
- seasonal presentation layers
- featured tournament packages

Every addition requires a performance budget, identity brief, gameplay purpose, mobile review, and maintenance plan.

---

## Deferred possibilities

The following ideas require separate strategic approval and are not implied by V2:

- synchronous real-time multiplayer
- eighteen-hole default rounds
- complex guild systems
- user-generated public courses
- gameplay-affecting equipment
- additional currencies
- native app-store builds

They may be researched later, but should not distract from the current product advantage.

## V2 completion definition

V2 is complete when:

- production and development are safely separated
- the release process is reliable
- the game feels materially more polished on real devices
- characters and courses have stronger identity
- audio and atmosphere are coherent
- regular content can be operated safely
- internal tools reduce recurring engineering work
- player behavior guides tuning
- the core three-hole experience remains fast, understandable, and stable

The V2 question is not “How many features were added?” It is “How much more intentional, premium, and sustainable did the game become?”