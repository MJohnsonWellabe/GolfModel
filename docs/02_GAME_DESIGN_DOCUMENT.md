# 02_GAME_DESIGN_DOCUMENT.md

# Johnson's Golf
## Game Design Document
Version 1.0

---

# Purpose

This document defines every major gameplay system in Johnson's Golf.

The goal is to ensure every mechanic works together to create a golf game that is:

- Easy to learn
- Difficult to master
- Highly replayable
- Skill based
- Mobile first
- Visually satisfying

Whenever new features are added they should support these systems rather than replace them.

---

# Core Gameplay Loop

The game should be playable in three minutes but enjoyable for hundreds of hours.

The loop is:

Open Game

↓

Guest or Login

↓

Choose Mode

↓

Choose Golfer

↓

Choose Course

↓

Play Three Holes

↓

Earn Coins + XP

↓

Unlock Cosmetics

↓

Improve Personal Bests

↓

Play Again

Every action should naturally encourage another round.

---

# Gameplay Philosophy

Johnson's Golf should never feel automatic.

Every shot asks the player questions.

Examples:

• Which club?

• What trajectory?

• Should I attack?

• Should I play safe?

• How much spin?

• How much wind?

Good decisions should consistently beat lucky decisions.

---

# Shot Flow

Every golf shot follows this sequence.

1. Evaluate lie

2. Read wind

3. Select club

4. Aim

5. Select strike location on golf ball

6. Execute three-click swing

7. Apply aerial spin (if desired)

8. Observe landing

9. Evaluate next shot

No step should feel unnecessary.

---

# Swing Meter

The swing meter is the heart of Johnson's Golf.

Goals:

Simple.

Fair.

Rewarding.

Difficult to master.

The meter should consist of:

Tap 1

Start swing.

Tap 2

Set power.

Tap 3

Set accuracy.

Rules:

Perfect timing should be difficult.

Near perfect should still be good.

Poor timing should noticeably affect results.

No hidden assistance.

No dynamic difficulty.

No enlarged perfect zones.

If the player hits perfect, they earned it.

---

# Shot Accuracy

Shot accuracy should be determined by:

Golfer Accuracy

Lie

Club

Wind

Swing timing

Power timing

Perfect Zone

Accuracy should produce realistic dispersion.

Long clubs should scatter more than wedges.

Bad swings should produce believable misses.

---

# Power

Power should matter.

Distance differences should be significant.

Target Driver Distances:

Weak Power

250 yards

Average

280 yards

Strong

320 yards

Players should immediately notice the difference between golfers.

---

# Club System

Every club should have personality.

Driver

Longest distance

Lowest control

Fairway Wood

Long but safer

Hybrid

Forgiving

Long Iron

Lower trajectory

Mid Iron

Balanced

Short Iron

High accuracy

Wedge

Maximum spin

Putter

Highest precision

Club selection should be meaningful.

---

# Ball Flight

Ball flight should feel believable rather than simulated.

Influenced by:

Wind

Club

Power

Lie

Strike location

Spin

Player attributes

The camera should emphasize flight.

---

# Strike Location

Before every shot the player may choose impact location on the golf ball.

Top

Lower launch

Forward roll

Bottom

Higher launch

Backspin

Left

Fade

Right

Draw

Extreme positions should increase risk.

---

# Spin System

While the ball is airborne:

Swipe Left

Increase left spin.

Swipe Right

Increase right spin.

Swipe Up

Topspin.

Swipe Down

Backspin.

Spin effectiveness depends on:

Club

Distance

Player skill

Current velocity

Spin should never feel exaggerated.

---

# Wind

Wind should always matter.

Factors:

Speed

Direction

Elevation

Shot height

Lower shots reduce wind influence.

High shots exaggerate it.

Players should learn to compensate naturally.

---

# Lies

Fairway

Best control.

First Cut

Slight penalty.

Rough

Reduced spin.

Reduced control.

Deep Rough

Major penalty.

Sand

Reduced distance.

Reduced spin.

Road

Hard bounce.

Trees

Recovery shots.

Buildings

Ball cannot pass through.

---

# Greens

Greens should require thought.

Display:

Grid

Slope arrows

Break visualization

Factors:

Speed

Slope

Distance

Putting skill

Long putts should be difficult.

Short putts should still require precision.

---

# Chipping

Chip shots should reward creativity.

Players may:

Bump and run.

High flop.

Standard chip.

Backspin should matter.

Rollout should matter.

---

# Physics

Physics should always appear believable.

Bounce

Roll

Spin

Slope

Collisions

Friction

Different surfaces should produce different reactions.

Buildings must block shots.

Trees must block shots.

Roads should bounce differently than grass.

---

# Golfer Attributes

Five primary attributes:

Power

Accuracy

Approach

Chipping

Putting

Attributes should have meaningful gameplay impact.

Overall ratings remain close.

Player identities remain distinct.

Example:

Jeff

Short hitter.

Elite accuracy.

Elite short game.

Matt

Long hitter.

Excellent irons.

Average short game.

Zac

Long hitter.

Elite chipping.

Less accurate.

Every golfer should immediately feel different.

---

# Fire System

Playing well creates momentum.

Two consecutive perfect swings activate Fire Mode.

Benefits:

Slight confidence bonus.

Visual effects.

Audio feedback.

Never large enough to remove challenge.

Fire Mode rewards consistency.

It should not become a comeback mechanic.

---

# Difficulty Philosophy

The game should become difficult through decision making.

Never through unfair randomness.

Never through input delay.

Never through hidden modifiers.

The player should always understand why a shot succeeded or failed.

---

# AI

AI opponents should have personalities.

Aggressive.

Conservative.

Risk taking.

Short game specialists.

Power hitters.

Different AI golfers should attack holes differently.

---

# Game Modes

Current:

Solo — three holes, you against the course.

1 vs 1 — match an AI rival, lowest total wins.

Scramble — team up with an AI partner, best ball counts.

AI Tournament — three rounds on a three-course rota against a field of AI
pros. The AI never plays on screen: after each of the player's rounds the
field's scores for the same course come from the real round simulator, and
the leaderboard updates between rounds. Final placement pays a coin purse.
(Replaced the Ace Challenge.)

Online Tournaments — shareable-code events over the shared leaderboard;
everyone plays identical wind and pins, lowest total wins.

Future:

Career

Daily Challenge

Closest to Pin

Longest Drive

Speed Golf

Season Events

Every mode should reuse core gameplay rather than introduce separate mechanics.

---

# Rewards

Every round should reward progress.

Coins

Experience

Statistics

Achievements

Records

Players should never feel a round was wasted.

---

# Economy

Coins purchase:

Balls

Shirts

Shoes

Hats

Dresses

Club skins

Club upgrades

No gameplay purchases using real money.

No pay-to-win mechanics.

Skill always wins.

---

# Accessibility

Support:

Left-handed play

Colorblind options

Reduced motion

Large text

Simple controls

Optional tutorials

The game should be enjoyable by children and adults alike.

---

# Design Principles

Whenever adding a feature ask:

Does this improve golf?

Does this improve strategy?

Does this improve replayability?

Does this improve presentation?

Does this improve player satisfaction?

If not, reconsider the feature.

---

# Future Expansion

This design should scale naturally to include:

New golfers

New courses

Weather

Career mode

Online tournaments

Clubhouse

Statistics

Friends

Replay system

Seasonal content

The architecture should never require major redesign to support future growth.

---

# Final Design Goal

Johnson's Golf should become the benchmark for premium mobile golf games.

The game should feel satisfying from the first shot while offering enough strategic depth that players continue improving for years.

Every system described in this document exists to support that single goal.

---

# Appendix A - Gameplay Tuning Targets

This appendix defines the intended gameplay balance for Johnson's Golf.

These numbers are targets rather than hard rules. Future balancing should remain close to these values unless testing clearly demonstrates a better experience.

---

# Overall Scoring Philosophy

Johnson's Golf is an arcade golf game with realistic decision making.

Players should score better than in real golf, but not so easily that birdies become routine.

Target experience:

New Player
+4 to +8 over 18 holes
(approximately +1 over a 3-hole round)

Average Player
Even Par to +2

Good Player
2–5 under par

Expert Player
5–8 under par

Exceptional Rounds
9–12 under par

Anything significantly better than this should require outstanding play rather than luck.

---

# Three Hole Challenge Targets

Average casual player

+1

Average returning player

Even

Good player

-1

Excellent player

-2

Outstanding round

-3

A score of -3 should feel like an accomplishment rather than an expectation.

Eagles should be exciting.

Birdies should feel earned.

Pars should never feel disappointing.

---

# Driver Distances

Power Rating | Carry
-------------|------
70 | 245 yds
75 | 255 yds
80 | 270 yds
85 | 285 yds
90 | 300 yds
95 | 310 yds
100 | 320 yds

Wind, elevation, rollout, and strike location should create additional variation.

---

# Fairway Accuracy

Perfect Swing

Driver

85%

Fairway Wood

90%

Hybrid

92%

Irons

95%

Missed Accuracy

Driver

60%

Fairway Wood

70%

Hybrid

75%

Irons

82%

Heavy misses should occur occasionally.

A perfect swing launches on the intended start line — the start line is earned.
It does not guarantee a perfect final position: carry distance still varies
slightly and wind still bends the ball in flight, but a perfectly timed, centered
swing from a clean lie never begins offline. Off-perfect timing is what starts the
ball left or right.

---

# Shot Dispersion

Dispersion here is the START-LINE offset — how far offline the ball begins.
Final position also varies with carry distance and wind.

Perfect Swing

Launches on the intended start line (no start-line offset).

Good Swing (start-line offset)

Driver

8–15 yards

Fairway Wood

6–10 yards

Long Iron

5–8 yards

Short Iron

3–6 yards

Wedge

2–4 yards

Poor Swing

Multiply the good-swing dispersion by approximately 2.5.

---

# Wind Effect

5 mph

Minimal adjustment.

10 mph

Noticeable.

15 mph

Requires planning.

20 mph

Changes club selection.

25+ mph

Changes strategy entirely.

---

# Putting Success Rates

Perfect Read + Perfect Stroke

Distance | Make %
---------|-------
3 ft | 99%
5 ft | 94%
8 ft | 82%
10 ft | 68%
15 ft | 45%
20 ft | 28%
30 ft | 12%
40 ft | 5%

Average Read

Distance | Make %
---------|-------
5 ft | 88%
10 ft | 50%
15 ft | 25%
20 ft | 12%
30 ft | 3%

Bad Read

Very few putts beyond six feet should fall.

---

# Chip Success

Perfect execution

Within 10 yards

40% chance to hole out

Within 20 yards

15%

Within 30 yards

6%

Average execution

Reduce by roughly half.

Poor execution

Almost never hole out.

The goal is to leave tap-ins rather than constantly make chips.

---

# Green Speed

Slow

10 Stimp

Medium

11.5

Fast

13

Tournament

13.5+

Faster greens should exaggerate mistakes rather than become unfair.

---

# Rough Penalties

First Cut

95% power

90% spin

Light Rough

90% power

80% spin

Heavy Rough

80% power

60% spin

Deep Rough

65% power

40% spin

---

# Sand Penalties

Fairway Bunker

90% power

85% spin

Greenside Bunker

80% power

90% spin

Wet Sand (Future)

70% power

75% spin

---

# Spin Effectiveness

Driver

20%

Fairway Wood

35%

Hybrid

45%

Long Iron

55%

Mid Iron

65%

Short Iron

80%

Wedge

100%

Topspin should increase rollout.

Backspin should reduce rollout.

Sidespin should create realistic shot shaping.

---

# Perfect Zone Width

Accuracy Attribute | Perfect Width
-------------------|--------------
60 | Very Small
70 | Small
80 | Medium
90 | Large
100 | Very Large

Power timing and accuracy timing should each use separate windows.

Perfect should never exceed roughly 10% of the swing meter.

Perfect swings should feel rewarding because they are difficult.

---

# AI Difficulty Targets

Easy

Average Score
+2

Medium

Even

Hard

-2

Legend

-4

Legend AI should beat poor play consistently but still make believable mistakes.

---

# Risk vs Reward

Aggressive shots should always offer meaningful upside while introducing genuine danger.

Example:

Attack a tucked pin

Reward:
Birdie opportunity

Risk:
Short-sided bunker

Safe shot

Reward:
Easy par

Risk:
Longer birdie putt

Players should regularly face these decisions.

---

# Pace of Play

Average shot setup

5–8 seconds

Average hole

45–60 seconds

Three-hole round

3–5 minutes

Players should be able to finish a complete round during a short break while still feeling that each shot mattered.

---

# The "One More Round" Test

Every completed round should leave the player believing they could improve with better decisions or execution.

Players should rarely blame randomness.

Instead they should think:

"I should have taken one more club."

"I misread that putt."

"I should have aimed away from that bunker."

"I hit that too hard."

That feeling is the foundation of Johnson's Golf.

---

# Appendix A Calibration Note (Phase 2, 2026-07-08)

Phase 2 implemented Appendix A via seeded Monte-Carlo suites
(`tests/simulation/`). The putting make-rate table and the shot-dispersion
table are honored as written — they are the moment-to-moment feel. Three
places the tables over-constrain each other, resolved as follows:

1. **Fairway accuracy vs dispersion.** A driver whose p90 miss is ≤15yd puts
   ~97% of perfect drives inside a 30yd corridor, not 85%. Dispersion wins;
   perfect-swing fairway rates run ~93-99% and missed-swing rates ~40-60%.
2. **Scoring tiers vs putting.** With 10ft putts at 68% and Bible-compliant
   hole design, the excellent tier calibrates to ≈ −0.8 per 3 holes rather
   than −2 (a −2 average requires ~6ft proximity, which the dispersion table
   forbids). Tier ORDER, spacing (~0.7/tier), and "−3 is an accomplishment"
   are preserved: casual ≈ +1.3 · returning ≈ +0.5 · good ≈ −0.3 ·
   excellent ≈ −0.8.
3. **Chip-ins.** Laser-aimed test chips hole above the 40/15/6 curve because
   lateral error barely matters at the tight cup; in play, aim/read error
   restores most of the gap. Revisit in the Phase 9 final balance pass.

Also fixed while calibrating: the rolling integrator's systematic v0·dt/2
shortfall (putts died ~1px short of intent — masked for years by the old
2.4px cup); lip-outs now eject clear of the hole; full shots gained
power-scaled depth noise (delicate part-swings ~6%, committed swings ~2%).

## Drive-distance trim (playtest, "drives going too far")

The woods (driver/3W/5W) now carry ~10% less (`PHYSICS.driveDistanceScale =
0.9`); irons, wedges and the putter are unchanged. This is a deliberate
difficulty increase requested in playtest: drives were flying too far. The
FB9 putting rework had lifted the excellent tier back toward ≈ −2, but losing
~10% of driver carry costs skilled players par-5 reachability and returns the
whole tier curve to the Phase 2 calibration above — excellent ≈ −0.8 per 3
holes. Tier order and the "−3 is an accomplishment" rule are preserved.

## v1.0 convergence pass (gameplay trust & shot physics)

Four "no hidden assistance / believable dispersion" fixes, all regression-gated:

- **Slope-aware putt pace (A1).** The putt power meter now reads the REAL green
  break for its pace target (the aim LINE still runs on a flat, no-slope engine
  so it never reveals the break — the player still owns the read). Previously
  the pace math ran on the flat aim engine, so its slope compensation was always
  zero and an uphill putt died short (~20ft on a steep read) while a downhill one
  ran long. On-green pace on a flat green is unchanged.
- **Fringe-transition pace (A1b).** A putt sitting barely off the green (~1in of
  fringe) used to lose distance far out of proportion to the fringe it crossed —
  a near-cliff, not the smooth cost it should be. Root cause was the launch-speed
  friction sampler missing a sub-step fringe stretch at the origin while the
  roll integrator over-braked the first step; fixed with origin-weighted
  trapezoidal sampling. Fringe friction itself is unchanged; an all-green putt is
  byte-identical.
- **Rough dispersion (A3/ADJ-2).** Non-perfect strikes from rough now scatter
  noticeably wider (good ≈ 2-5× the fairway, miss clearly worse and harder to
  control) while a PERFECT strike stays tight — skill (striking the meter) is
  rewarded. `lieError.rough` 3.5°→4.0°; lie quality multipliers perfect
  0.5→0.30 / good 1.0→1.15 / miss 1.6→2.1. Carry loss (0.75×) is unchanged.
- **Tee default aim (A4).** A tee shot's default aim lays the club's FULL carry
  out down the strategic corridor instead of clubbing DOWN to a lay-up elbow
  inside the driver's range (Wildwood 3). It still never parks the default aim in
  water (it lays up short of a wet full-carry point).

Also hardened: True Vision is a v1.0 quality gate (A2/ADJ-6) — a perfect,
noise-free shot lands exactly where True Vision showed it (parity regression
tests across every course, surface, slope, club, spin and wind).
