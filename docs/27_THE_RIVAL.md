# 27 — The Rival

**Status:** IMPLEMENTATION RECORD (daily-return retention pass). Flag: `rival`,
dev-only. Depends on `roundRecording`, `ghostRace` and `dailyHole`.

## The problem

The game has streaks, mastery stars, personal records, weekly events,
achievements and a season pass. Every one of them is a number that goes up. Not
one of them is a reason to come back **today rather than whenever**, because
nothing is waiting: the numbers accrue silently whenever the player happens to
play. The Hole of the Day fixed *what* to play. It did not fix *why now*.

## What the products that own the daily habit actually do

Four patterns, and they agree with each other more than they disagree.

**Duolingo — the unit you count is the biggest decision.** Streaks took
next-day retention from 12% to 55%, and the mechanism is loss aversion: users
protect the streak rather than pursue it. Two design notes carried straight over
here. First, the bar must be a real action ("one finished lesson", not one tap)
or the streak recruits people who do not care and stops meaning anything.
Second, repair matters — streak freezes are *mercy infrastructure*, and products
that let a streak survive illness or travel retain people through it. Two
freezes beat one; three are about the same as two.

**Wordle — one shared puzzle, once a day.** Everyone gets the same word. The
scarcity is the product: one attempt creates anticipation and a shared moment,
and the shareable result spoils nothing. No timers, no pressure, no ads.

**Strava — the reference group matters more than the mechanic.** Strava replaced
one demotivating global leaderboard with millions of small motivating ones.
People are moved by comparison to someone they could *plausibly beat*; mid-pack
users disengage when the only feedback is a distant elite. A 1.2 km climb with a
visible leaderboard feels concrete in a way a 40 km ride does not.

**Golf Clash / Real Racing 3 — the rematch, and the ghost.** The most-used
button after a loss is *rematch*. And asynchronous racing against a recorded run
carries roughly 30% better six-month retention than synchronous play, because it
fits a phone: no matchmaking, no latency, no waiting for a human to be awake.

What none of them do — and what this game's constitution forbids anyway (rule 9)
— is energy systems, loot boxes, fear countdowns or forced ads. Golf Clash's
wager system is an energy mechanic; it is the one thing here we deliberately did
not copy.

## The design

**One named opponent. One fixture a day. A record that is never finished.**

A rival is all four patterns at once: the smallest possible leaderboard (two
people), a shared daily fixture, a standing rematch, and — because rounds are
stored as inputs — an actual ball in the air beside yours rather than a number
on a card. The scoreboard is not "your best round"; it is *"Dana leads 12–9"*,
which is a sentence about a relationship and is unfinished by construction.

It reuses the whole existing stack rather than adding a parallel one
(constitution rule 10): the Hole of the Day is the fixture, `RoundRecording` is
the wire, `GhostRun` is the presentation, and the rival's line lives *inside* the
daily card so the landing gains no new surface and nothing scrolls (rule 5).

### Two kinds of rival

| | Friend | House |
| --- | --- | --- |
| Who | a real person | assigned, named, seeded |
| Their round | what they actually played, fetched | genuinely played headlessly |
| Standard | whatever they shoot | calibrated just above you, and drifts |
| Needs a network | yes | no |

A **house rival** exists so the feature works on day one for a player who knows
nobody — which is most players. Theirs is not a fabricated score: the game's own
`AIController` picks every club, aim and shape, a modeled human swing executes
them, the real physics resolves them, and every decision is captured as a
`ShotInput`. The result is an ordinary `RoundRecording`, indistinguishable in
kind from one a person produced, and the tests verify it against the same replay
engine that verifies a human's.

### Calibration: what varies, and why it is the swing

A replayed recording assembles its golfer from the character and archetype the
recording **names**. So anything varied to hit a difficulty target must be
something the recording carries — otherwise the replay plays a different golfer
than the one that played, which is exactly the class of bug that cost a day in
docs/26_SCALE_PASS.md.

The recording carries every swing verbatim. So the golfer is **fixed** and what
varies is how steadily the rival strikes it: a gaussian timing error on the
meter, the same `UserSwingModel` the difficulty simulator uses. A shakier rival
makes worse swings, and those swings are what gets recorded.

The standard is searched, not asserted — the ladder runs until the round the
rival *actually plays* lands on the target. A rival who was supposed to shoot
level and instead shot +4 would be a liar with a ghost to prove it.

### Keeping them beatable

A fixed standard decays into one of the two failure modes the design exists to
avoid. Beat them five days running and they are furniture; lose five running and
they are a wall. So the standard drifts against recent form — quarter-stroke
steps, and only on a clean three-day sweep either way. A close rivalry is a good
rivalry and is never touched. Only house rivals drift: quietly adjusting a real
person's score would be a lie.

### The friend rivalry is mutual, so a link cannot do it

A share link is one-way — the person who opens it learns who sent it, but the
sender never learns who accepted. So the link carries a **code** naming a
rendezvous both sides read (`/rivalInvites/{code}`): the inviter writes `from`,
the accepter writes `to`, and each side adopts the other from the half it did not
write. Both halves are write-once.

Their daily rounds then flow through `/rivals/{pair}/{date}/{player}` — one small
doc per person per day holding the round **as inputs**, which is what lets their
ghost be re-flown exactly as they hit it rather than approximated from a score.
The pair id is derived by hashing both player ids (order-independent), so each
side computes it without negotiating and the node name discloses neither
identity. A friend who has not played yet is an ordinary state: the card says
"hasn't played today yet" rather than inventing an opponent.

Trust is the same friends-tier model as tournaments and challenges, and is
documented as such in docs/FIREBASE_SETUP.md — with one real improvement: a
fabricated entry now has to be a physically valid round that replays to its
claimed score, which is what `verifyRound` checks server-side.

## Bugs found along the way

Building on the recording stack exercised paths that had never been exercised,
and three of them were broken. All three were silent — the symptom in each case
was a recording being dropped, which looks from the outside like nothing at all.

1. **`roundGolfer` re-rolled the loadout and told nobody.** An unlocked profile
   picks a random character and archetype every round; those choices lived in
   function locals, and `sealRoundRecording` stamped the recording from
   `profile.character/archetype` instead. So the recording named a golfer who
   did not play, the replay assembled that golfer, and the round did not
   reproduce. **This was the default state** — every round, for every player who
   never visited the Locker Room. Every existing test named a loadout explicitly,
   which locks it, which happens to make the two agree; the new
   unlocked-loadout gate is the one that sees it.
2. **The equipped perk was not recorded.** Perks raise stats and widen the
   perfect zone, so a replay without one assembles a weaker golfer. Recordings
   now carry `pk`.
3. **A daily round's recording was stamped with the wrong course.**
   `courseIdByName` searched only the static roster, and the generated hole is
   registered at runtime under a reserved id — so a daily attempt fell through to
   the default course id and the verifier replayed the generated hole's shots on
   Wildwood. No daily attempt could ever verify.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` — **1014 passed, 1 skipped**.
- `tests/simulation/rival.test.ts` (22): the head-to-head settles a day exactly
  once however many times it is reported, survives corrupt storage, merges two
  devices without double-counting, and refuses to blend two different rivals;
  the standard drifts only on a clean sweep and never for a friend; a
  synthesised round **verifies against the real replay engine**, is raceable as
  a ghost with a shot to fly on every hole, is identical on every device, and
  lands within a stroke a hole of the standard it was asked for.
- `tests/rivalChannel.test.ts` (5): the pair id is order-independent, unique per
  pair, a safe path segment, and discloses neither player id.
- `tests/visual/rival.spec.ts` (2): a named rival with a score is waiting on the
  daily card, the play button names them, their ball actually flies beside the
  player's during the round, and the fixture settles afterwards.
- `tests/visual/roundRecording.spec.ts` (3): now includes the unlocked-loadout
  round that bug 1 above made impossible.

## Known limitations

- **A friend rivalry needs both sides to play.** A day where one of them never
  tees off simply does not settle. That is correct — but it means a lapsed
  friend quietly ends the fixture, and there is no nudge back. A house-rival
  fallback for an inactive friend is the obvious next step.
- The rival plays the **daily hole only**. The same machinery would carry a
  rivalry across a full round on any course; the daily is where the shared seed
  and the one-attempt rule already live.
- Rival rounds are not yet server-verified — `verifyRound` is written and
  bundled but not deployed (docs/26_SCALE_PASS.md).
- The house rival's calibration is searched over a fixed steadiness ladder. It
  lands within a stroke a hole, which is close enough to feel deliberate, but a
  finer search would be cheap if it ever reads as loose.
