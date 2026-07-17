# Bite-Sized Golf — Design Constitution

**Status:** AUTHORITATIVE  
**Purpose:** Non-negotiable rules for every future Claude prompt, design decision, and release.

## 1. Gameplay comes first

A feature may not weaken swing responsiveness, shot readability, putting control, camera clarity, scoring correctness, or the player's ability to understand cause and effect.

## 2. Performance is a feature

Performance is not cleanup work. Input latency, frame pacing, memory stability, loading behavior, and repeat-round health are release criteria. A visual enhancement that causes meaningful control lag must be redesigned, deferred, or made adaptive.

## 3. Browser-first and mobile-first

The primary experience must work without installation on realistic phones. Desktop may gain convenience, but mobile may not receive a compromised version of the core game.

## 4. The three-hole format is sacred

The default product promise remains a complete, satisfying three-hole round. New modes may vary rules or presentation, but should not turn the main experience into a long-session golf simulation.

## 5. Primary actions should not require scrolling

The player should see the next important action on a normal phone viewport. Results, Replay, Play Next, course entry, Daily entry, Store purchasing, and profile settings must prioritize compact, progressive disclosure.

## 6. Skill matters more than luck

Wind, lie, elevation, club choice, aim, power, accuracy, and putting reads should create understandable decisions. Randomness may create variety, but must not make outcomes feel arbitrary.

## 7. Respect the player's time

Startup should be fast. Menus should be shallow. Replays should be immediate. Play Next should preserve compatible settings. The game must not insert chores between rounds.

## 8. Cosmetics never affect gameplay power

Characters, Pals, outfits, trails, celebrations, and other cosmetic items may express identity but may not provide competitive shot advantages.

**Grandfathered exception (decided 2026-07-17):** the shipped club-upgrade system (two coin-purchased tiers per club family granting small stat bonuses and a wider perfect zone, shown as gold clubs) is retained as the one sanctioned progression-power system: earned only with playable coins, no real-money path, transparent capped effect. It may be tuned but not expanded; any NEW gameplay-affecting equipment remains deferred per the V2 roadmap.

## 9. Retention must be earned

Use mastery, personal records, Daily and Weekly challenges, visible improvement, collection, surprise, and community comparison. Do not use loot boxes, energy systems, fear-based countdowns, forced ads, or deliberately opaque economies.

## 10. Simplicity beats feature count

Every new system must justify its interface, data model, maintenance cost, performance cost, testing burden, and cognitive load. Prefer improving an existing system over adding a parallel one.

## 11. Content is preferred over mechanical sprawl

After the core is polished, favor new holes, course variants, challenges, characters, Pals, cosmetics, events, and atmosphere over permanent new gameplay mechanics.

## 12. Every course needs an identity

A course is not only terrain. It needs a visual silhouette, environmental sound, movement, color mood, landmark language, gameplay character, and memorable moments.

## 13. Every character needs personality

Characters should be recognizable through silhouette, stance, idle behavior, reactions, celebration, and emotional tone. Personality should not require dialogue or lengthy cinematics.

## 14. Audio obeys one source of truth

All music, ambience, UI sounds, gameplay sounds, and celebrations must respect the effective audio setting. No scene or feature may bypass global preference management.

## 15. Production must remain stable

Future development occurs in an isolated development environment. Production receives only reviewed, validated, intentional releases. No experiment should endanger the public game or production player data.

## 16. Live Ops should become data-driven

Daily, Weekly, featured, Store, Season Pass, marketing, and event configuration should increasingly be authored through validated tools rather than one-off code changes.

## 17. Analytics must answer product questions

Do not collect events merely because they are easy to collect. Each metric must support a decision, such as improving next-round conversion, identifying a difficult hole, or evaluating a featured event.

## 18. Guest players are real players

Guest activity must be measured and supported without pretending guests are accounts. Identity transitions must not duplicate progress, rounds, or analytics.

## 19. Accessibility is part of quality

Text, contrast, touch targets, reduced motion, sound-independent feedback, and understandable controls should be treated as normal design responsibilities.

## 20. Every release must leave the codebase healthier

New work must include tests, cleanup, documentation, error handling, disposal behavior, and migration thinking. Temporary shortcuts require an explicit removal plan.

## Feature admission test

Before implementing a major feature, Claude must answer:

1. Which player problem does this solve?
2. Which executive priority does it advance?
3. Can the goal be achieved by improving an existing system?
4. What is the mobile interaction?
5. What is the performance cost?
6. What data and migration are required?
7. How is it tested?
8. How does it fail gracefully?
9. How is it configured after launch?
10. What will be removed or simplified to offset added complexity?

If these answers are weak, do not build the feature yet.

## Prohibited shortcuts

- Reducing core responsiveness to preserve an effect
- Hardcoding Live Ops content that should be configurable
- Adding duplicate settings stores
- Creating a new currency without a compelling product need
- Shipping primary mobile screens that depend on scrolling
- Adding engagement mechanics that pressure or mislead players
- Writing analytics or persistence synchronously on critical input paths
- Leaving observers, scenes, textures, audio, timers, or listeners undisposed

This constitution governs the roadmap. Roadmap phases may add detail, but may not contradict these rules.