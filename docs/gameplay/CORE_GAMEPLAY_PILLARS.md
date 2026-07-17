# Core Gameplay Pillars

**Status:** AUTHORITATIVE

## Purpose

This document protects the feel of the game while presentation, content, and systems evolve.

## Pillar 1 — A shot is a decision plus execution

Before swinging, the player should consider aim, club, power, wind, lie, elevation, landing area, and risk. During execution, timing and control matter. After the shot, the game should make the relationship between decision, execution, and outcome understandable.

## Pillar 2 — Simple controls, meaningful consequences

Controls should be quickly learnable and consistent. Simplicity does not mean guaranteed success. A small number of understandable inputs should produce a wide range of golf outcomes.

## Pillar 3 — Recovery remains fun

A missed fairway, difficult lie, bunker, tree obstruction, or long putt should create a new strategic problem. The player should retain agency instead of feeling the round is already lost.

## Pillar 4 — Putting is readable but not automatic

Slope, distance, line, and pace should matter. True Vision may help the player understand a putt, but should not replace execution or create synchronous work on the tap path.

## Pillar 5 — The course is the opponent

Course geometry, hazards, wind, elevation, pin position, and alternate routes should create identity. Difficulty should come from authored golf problems, not hidden stat disadvantages.

## Pillar 6 — Modes enhance, not replace, golf

Fire Mode, True Vision, Daily rules, Weekly seeds, and future event modifiers should reinforce the core swing and course systems. They should not fragment the game into unrelated control schemes.

## Pillar 7 — Fast continuation

Replay and Play Next are part of the gameplay loop. They must preserve responsiveness, compatible settings, correct state, and resource stability.

## Gameplay integrity rules

- Cosmetic ownership never changes shot power or accuracy.
- Guest players receive the same core gameplay.
- Network availability must not determine whether a local shot can be played.
- Analytics, profile saves, and reward writes stay off critical input paths.
- Camera polish may not hide ball flight or landing information.
- Atmospheric effects may not obstruct aim, target, ball, cup, or slope readability.
- New assists must be visible, understandable, and consistently applied.

## Tuning method

Gameplay changes require:

1. A clearly described player problem.
2. Baseline behavior and measurements.
3. Course-by-course testing.
4. Mobile input validation.
5. Regression coverage for scoring and state.
6. Side-by-side playtesting where practical.
7. Documentation of intended skill impact.

Do not change multiple fundamental variables at once unless the change is an intentional full-system rebalance.

## Preserve the current foundation

The completed retention and performance work established a stable core with proportional accuracy, meaningful putting, records, mastery, Replay, Play Next, Daily and Weekly structures, and protected input paths. V2 should polish and deepen this foundation rather than repeatedly rewriting it.

The desired gameplay reaction is: “I understand the shot, I made the choice, and I want another attempt.”