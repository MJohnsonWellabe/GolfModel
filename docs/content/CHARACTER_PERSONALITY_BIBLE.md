# Character Personality Bible

**Status:** ACTIVE PLAN (personality layer implemented behind the
`personality` flag; this document is the authority on who each character is)
**Owner system:** `src/data/characterPersonality.ts` (parameters),
`src/slice3d/golfer3d.ts` (expression)
**Constitution:** rule 13 (every character needs personality), rule 8
(personality is cosmetic only — zero gameplay effect)

## Why personality, and why this shape

All 25 characters share one body pipeline (rigged chibi glbs from the
"Cute Characters 4" pack) with seven baked clips — A-pose, Idle, Run, Sad,
Song Jump, Walk, Win — of which the game uses Idle, Win, Sad, and Song Jump.
There is no budget (and no need) for bespoke animation per character: the pack
has no more clips, and 25 unique rigs would blow the compressed-asset budget
for a browser game.

Personality therefore comes from **parameterizing what already animates**:
idle tempo, aim waggle, celebration selection and amplitude, dejection depth,
and reaction hold time. Ten data-driven numbers per character — zero new
assets, zero new draw calls, zero steady-state cost. This is the "reusable
versus unique" answer Prompt 7 asks for: **everything is reusable; identity
lives in tuning data.**

## The archetype system

Characters group into six personality archetypes. Each archetype is one
parameter set; a character belongs to exactly one. (Per-character overrides
are possible in data but start unused — archetypes must prove insufficient
before we add 25-way bespoke tuning.)

| Archetype | Essence | Idle | Aim waggle | Celebrate | Deject | Epic moment |
|---|---|---|---|---|---|---|
| **Showman** | Plays to the crowd; every putt is theater | quick (1.15×) | broad, slow | Song Jump on ANY celebrate-worthy score, high double hop | theatrical slump (deep, long) | Song Jump, extra hop |
| **Cool Customer** | Unbothered; wins like they expected it | slow (0.85×) | minimal | Win clip, single low hop | brief shrug (shallow, short) | Win clip (even an ace barely moves them — that IS the joke) |
| **Bouncy Rookie** | Can't stand still; every round is the best day ever | fast (1.25×) | quick, eager | Win + rapid triple hop | short (bounces back fast) | Song Jump, fastest hops |
| **Steady Pro** | Textbook golfer; controlled in both directions | neutral (1.0×) | textbook | Win, standard hop | standard | Song Jump reserved for eagles+ (today's default behavior) |
| **Fiery Competitor** | Burns hot; every miss stings | brisk (1.1×) | tight, fast | Win, sharp high hop | deep and fast (visibly hot) | Song Jump, hard hops |
| **Sunny Optimist** | Delighted to be outside; hard to discourage | relaxed (0.95×) | easy | Win, floaty hop | barely registers (shortest, shallowest) | Song Jump, gentle |

### Parameter glossary (the whole animation budget)

- `idleSpeed` — Idle clip playback rate (0.85–1.25). Procedural-fallback
  bodies map it onto sway rate.
- `waggleAmp` / `waggleRate` — pre-shot club waggle amplitude (×0.6–1.5) and
  frequency (×0.7–1.4) while aiming.
- `celebrateClip` — `'win' | 'song'`: which clip a normal celebrate uses.
- `epicClip` — clip for eagle+/hole-out moments (`'song'` or `'win'` for the
  Cool Customer gag).
- `hopAmp` — celebrate hop height multiplier (0.4–1.4).
- `hopRate` — hop frequency multiplier (0.8–1.6; Rookie's triple hop).
- `dejectDepth` — slump depth multiplier (0.35–1.3).
- `reactionHold` — seconds before returning to idle (1.2–2.0; the shared
  timeout is 1.6 today).

All parameters are clamped in code to the ranges above so no data edit can
create a broken pose, and reactions can never outlast the post-hole delay
window (2.4 s) — character work may not delay results navigation
(constitution 13 guardrail + Prompt 8 interruption risk).

## The roster

Names and one-line personalities are canonical — Store/menu copy should agree
with this table. (f_/m_ pack files per `src/data/characters.ts`.)

| Character | Archetype | Who they are |
|---|---|---|
| Chip | Bouncy Rookie | The eternal first-rounder; narrates his own shots under his breath |
| Rose | Steady Pro | Club champion three years running; nothing surprises her |
| Rio | Fiery Competitor | Keeps a mental ledger of every stroke lost to bad bounces |
| Sunny | Sunny Optimist | Genuinely believes every course is her favorite course |
| Theo | Steady Pro | Reads greens like tax law: slowly, correctly |
| Dez | Showman | Once celebrated a tap-in bogey; regrets nothing |
| Beat | Showman | Treats the tee box as a stage; the gallery is imaginary but adoring |
| Kuro | Cool Customer | Has never visibly reacted to an ace; rumored to have made three |
| Lily | Sunny Optimist | Applauds opponents' good shots, sincerely |
| Jade | Cool Customer | Sunglasses indoors, even on Wildwood's shaded back nine |
| Nova | Fiery Competitor | Plays every casual round like a major final |
| Milo | Bouncy Rookie | Sprints between shots; walking is for scorekeepers |
| Finn | Sunny Optimist | Thinks water hazards are "part of the fun" |
| Cole | Steady Pro | Pre-shot routine timed to the half second |
| Reid | Cool Customer | Answers "nice putt" with a nod, maximum |
| Enzo | Showman | Bows to the cup after long putts drop |
| Dash | Bouncy Rookie | Named accurately; the hop after a birdie has hang time |
| Knox | Fiery Competitor | Grips the club like it owes him money |
| Bree | Sunny Optimist | Keeps the round's mood afloat single-handedly |
| Coco | Bouncy Rookie | First to the tee, last to leave, vibrating throughout |
| Wren | Cool Customer | Quietly efficient; her scorecard does the talking |
| Ivy | Steady Pro | Course management so tidy it looks boring — until you count |
| Pia | Bouncy Rookie | Celebrates the group's shots as loudly as her own |
| Zuri | Fiery Competitor | Stares down the hole after a lip-out, every time |
| Remi | Sunny Optimist | Whistles between shots; bogeys don't dent the tune |

Distribution: Showman 3 · Cool 5 · Rookie 5 · Steady 4 · Fiery 4 · Sunny 5.

## Where personality shows (and where it must not)

**Shows:** in-hole idle/stance tempo, aim waggle, post-shot and post-hole
reactions, celebration selection, Store/Locker preview (the same golfer
renderer, so previews inherit personality automatically).

**Must not:** swing arc, swing timing, meter behavior, ball physics, input
latency, results navigation timing. The personality layer touches only
playback rates and amplitude multipliers on existing cosmetic animation, and
every reaction still hard-stops before the post-hole transition. AI opponents
draw from the same roster and therefore the same personalities.

## Rollout plan (Prompt 8)

1. **Controlled subset first:** flag `personality` (dev-on/prod-off) enables
   the layer; validation focuses on one character per archetype
   (Chip, Rose, Rio, Sunny, Dez, Kuro).
2. Validate: performance (no added per-frame allocation; playback-rate changes
   are free), blending (reaction → idle handoff at every hold length),
   cancellation (skip/rapid navigation mid-reaction), Store presentation, and
   the gameplay-interruption guarantee above.
3. Expand: nothing to expand in code — the mapping already covers all 25;
   real-device playtest tunes archetype parameters, not per-character data.

## Animation budget accounting

- New assets: **0**. New clips: **0**. New meshes/materials: **0**.
- New steady-state work: one multiply on existing idle-sway/waggle math.
- Memory: one frozen parameter object per archetype (6 total).
