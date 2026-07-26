/**
 * Feature flags (V2 dev-environment foundation — see
 * docs/technical/DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md §Feature flags).
 *
 * A flag is a named switch with a per-environment default and, for admins, a
 * runtime override. Flags exist to ship incomplete or high-risk systems safely
 * and to act as kill switches — they are NOT permanent configuration. Every
 * flag declares an owner and a removal condition so the set never rots.
 *
 * This is separate from `src/core/debugFlags.ts`, which parses one-shot CAPTURE
 * params (?hole/?cam/?freeze) for the screenshot harness. Feature flags gate
 * product behavior; debug flags position a deterministic screenshot.
 *
 * Override precedence (highest first), admins only:
 *   1. URL query      ?ff.<key>=on|off       (this load only)
 *   2. localStorage    ff.<key> = "on"|"off"  (sticky across loads)
 *   3. per-environment default from the registry
 *
 * Production safety: overrides are gated on `allowOverrides` (dev, or an admin
 * in prod). A normal production player always gets the registry default — the
 * URL/localStorage channels are inert for them.
 */

import { ENV } from '../config/env';

export interface FlagDef {
  key: string;
  description: string;
  /** Who owns the decision to flip or remove this flag. */
  owner: string;
  /** Default state per environment. */
  defaults: { prod: boolean; dev: boolean };
  /** When this flag should be deleted (so the set stays lean). */
  removeWhen: string;
}

/**
 * The flag registry. Add a flag here with both environment defaults and a
 * removal condition; feature code reads it via `flag('<key>')`.
 */
export const FLAG_DEFS: readonly FlagDef[] = [
  {
    key: 'devTools',
    description:
      'Admin-only development test controls (grant coins, reset mastery/achievements, ' +
      'simulate Daily/Weekly dates, seed leaderboard). Never available to production players.',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'never — permanent development affordance, gated to non-prod + admin'
  },
  {
    key: 'delight',
    description:
      'V2 Phase 2 screen-entrance animations (landing/wizard/results fade-ins). ' +
      'Toggles the html.ff-delight class the CSS is scoped under.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'juice',
    description:
      'V2 Phase 6 shot juice: camera punch on strike, a made-putt cup burst, and ' +
      'bolder/longer on-fire ball trails. Does not affect the existing shot feel when off.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'layouts',
    description:
      'V2 content expansion: seeded alternate tee/pin layouts. Authored pin sets ' +
      'replace the random-ellipse pin; alternate tees join the seeded draw. ' +
      'Off = the original random pins + fixed tees, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'newCourses',
    description:
      'V2 content expansion: Red Hollow + Wild Prairie in the course roster, ' +
      'Play Next rotation, and wizard. Off = the original four-course roster.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'RELEASED to prod (playtest-approved) — fold the two courses into the base roster & remove the flag'
  },
  {
    key: 'audio',
    description:
      'V2 Phase 5 audio identity: WebAudio SFX variation (impacts/putt/swing), ' +
      'surface-shaped landing thumps, per-course procedural ambient beds, and the ' +
      'results-screen UI tick. Off = the original HTMLAudio pipeline, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'personality',
    description:
      'V2 Phase 3 character personality: per-character idle tempo, aim waggle, ' +
      'celebration selection/amplitude, and dejection depth (data in ' +
      'characterPersonality.ts). Cosmetic only; off = the shared V1 behavior.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'atmosphere',
    description:
      'V2 Phase 4 ambient course life (drifting birds/gulls, ship bob, per-course ' +
      'motion tuning). Procedural, parked-RTT-safe.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'boundedWorld',
    description:
      'Global dev rule: each hole is built and rendered as a tightly bounded ' +
      'playable world (~20 yd past the playable corridor). Beyond the boundary ' +
      'is off-course VOID — no terrain detail, vegetation, or rocks are ' +
      'generated, and a ball crossing it takes a one-stroke off-course penalty ' +
      'dropped back in the rough. Populates HoleData.boundary (derived per hole, ' +
      'or authored). Off = the classic full-world behavior, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'RELEASED to prod (playtest-approved) — make bounded-world the sole path & remove the flag'
  },
  {
    key: 'courseRebuilds',
    description:
      'Dev-environment roadmap: the course TEARDOWN/REBUILD program. When on, ' +
      'rebuilt v2 variants of the base courses (src/data/courses/v2/) replace ' +
      'the shipped originals in the roster, course by course as each rebuild ' +
      'lands. Off = the shipped originals, byte-identical — production never ' +
      'loads a rebuilt course until the rework is approved and promoted.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'RELEASED to prod (playtest-approved) — fold the v2 JSONs over the ' +
      'originals and remove the flag'
  },
  {
    key: 'wildwoodPerf',
    description:
      'Wildwood Glen performance pass: a dev-only load-time transform that thins ' +
      'render vegetation the player cannot pick out from the tee (dense wood ' +
      'interiors, downrange/behind-tee trunks, backdrop woods), trims garden ' +
      'blooms marginally, and cheapens the water reflection. Collision hitboxes ' +
      '(hazard `spacing`) and hole geometry are untouched — visuals only. Off = ' +
      'the shipped Wildwood, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED to prod (playtest-approved) — fold the thinning into ' +
      'wildwood.json + course3d and remove the flag'
  },
  {
    key: 'tutorial',
    description:
      'Opt-in "Learn to play" onboarding: a landing entry that starts a scripted ' +
      'coaching round on Sable Bay #1 teaching aim, the swing meter, shot shape, ' +
      'in-flight spin, aerial view, the uphill-putt pace rule, and True Vision. ' +
      'Never forced; replayable. Off = no tutorial surface at all.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED to prod (playtest-approved) — remove the flag once onboarding ' +
      'has soaked'
  },
  {
    key: 'roundRecording',
    description:
      'Rounds are stored as the INPUTS that produced them (promoted to prod, owner pass 5), ' +
      'not just the score. The enabler for server-verified leaderboards, ghost ' +
      'head-to-head and shareable replays — the physics is deterministic, so a ' +
      'dozen numbers per round reproduce it exactly. Solo rounds only; each ' +
      'recording is self-checked against a replay before it is kept. Off = no ' +
      'recording is made, stored or read.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED to prod once ghosts + verified leaderboards ship on top of it'
  },
  {
    key: 'dragSwing',
    description:
      'TRACED SWING availability: a slim right-edge pad with a guide dot that ' +
      'runs straight down to the club\'s pull depth and back up; the gesture ' +
      'is to stay with it in tempo and on its line. This flag only OFFERS the ' +
      'control — the player chooses it per device in Settings → Swing, and ' +
      'the default is the three-click meter (owner pass 5). ONLY the input ' +
      'changes: power, the perfect/good/miss bands and the accuracy curve all ' +
      'come from the shared swingModel, so difficulty and every simulation ' +
      'stay exactly where they are calibrated. Off = the setting is hidden ' +
      'and everyone taps.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'DECIDED — either the trace becomes the default (and the tap meter ' +
      'becomes the option) or this is removed. It must not linger as a ' +
      'permanent fork.'
  },
  {
    key: 'practiceRange',
    description:
      'Practice ground (promoted to prod, owner pass 5): the default course\'s opening hole ' +
      'with no card, no stroke cap and no end — holing out just re-tees. Every ' +
      'golf game has one and this never did; it is where the swing is actually ' +
      'learned, and the only entry point that fits a 90-second session (a ' +
      'three-hole round does not). Nothing is scored, recorded, rewarded or ' +
      'counted toward a streak. Off = no practice surface.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'easeIn',
    description:
      "First-rounds ease-in (promoted to prod, owner pass 5): a device's first three casual " +
      'solo rounds draw the KINDEST authored pin on each green (nearest the ' +
      'middle — not tucked behind sand or on a shelf) instead of a seeded one. ' +
      'Simulation puts the casual first-hole blow-up rate at 10% on Wildwood ' +
      'and 8% on Timberline, and that lands before any progressive-disclosure ' +
      'reward unlocks. Never applied to a shared-seed round (weekly, challenge, ' +
      'tournament, daily, ghost) — those must stay identical for everyone.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'shotAttribution',
    description:
      'Post-shot breakdown (promoted to prod, owner pass 5): after the ball comes to rest, ' +
      'one line naming what actually produced the result — strike, wind, lie, ' +
      'and any sideways miss. Measured by re-flying the same resolved shot with ' +
      'one factor removed, so the numbers are real rather than estimated. Runs ' +
      'at rest, never on the tap path, and stays silent when there is nothing ' +
      'worth saying. Off = the existing distance-only readout.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'dailyHole',
    description:
      'Hole of the Day (promoted to prod, owner pass 5): a brand-new hole generated from the ' +
      'date, played hundreds of times by the headless simulator and only served ' +
      'if it lands in a fair-and-interesting band, wearing a shipped course\'s ' +
      'art direction. Same hole for every player, one attempt, spoiler-free ' +
      'shareable result. Turns a 21-hole game into an unlimited one. Off = no ' +
      'daily surface and nothing is generated.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED once a week of generated holes has been played and judged good'
  },
  {
    key: 'rival',
    description:
      'The Rival (promoted to prod, owner pass 5): one named opponent who plays the Hole of ' +
      'the Day every day, whose ghost flies beside you, and against whom a ' +
      'season-long head-to-head record accumulates. A friend rival is their ' +
      'real recorded round; with no friend, a house rival is assigned and their ' +
      'rounds are genuinely played headlessly at a standard calibrated just ' +
      'above the player. Requires `roundRecording`, `ghostRace` and ' +
      '`dailyHole`. Off = no rival surface and nothing is synthesised.',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'PROMOTED once a fortnight of rivalries has been played and judged good'
  },
  {
    key: 'verifiedScores',
    description:
      'Server-authoritative score verification (promoted to prod, owner pass 5): a finished ' +
      'round is submitted as its INPUTS and replayed by a Cloud Function ' +
      'running the game\'s own physics, which writes the result to a node the ' +
      'client cannot forge. Turns leaderboards from an honour system into a ' +
      'fact. Requires `roundRecording`, a signed-in player, and the deployed ' +
      'function (docs/26_SCALE_PASS.md). The live→replay round-trip is exact ' +
      'and gated by tests/visual/roundRecording.spec.ts.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED once the function is deployed and leaderboards read the ' +
      'verified node'
  },
  {
    key: 'ghostRace',
    description:
      'Ghost head-to-head (promoted to prod, owner pass 5): an opponent round recorded as ' +
      'inputs is re-flown shot for shot beside yours — a translucent ball in ' +
      'the air at the same moment as yours and a running standing in the HUD. ' +
      'Asynchronous, but it plays as though they were there. Currently raced ' +
      'against your own best round on the course; the same machinery accepts a ' +
      "friend's recording from a challenge link. Requires `roundRecording`. " +
      'The live→replay round-trip is exact, so a ghost flies the line its ' +
      'owner actually hit (tests/visual/roundRecording.spec.ts).',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'quickPlay',
    description:
      'One-tap Play (promoted to prod, owner pass 5): the landing\'s Play Now tees off ' +
      'immediately as a solo round on the course this device last played ' +
      '(default course on a first launch), and the mode/course wizard moves to ' +
      'an explicit "Course & mode" entry beneath it. Off = Play Now opens the ' +
      'wizard exactly as it does today and the extra entry is hidden.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'tutorialDepth',
    description:
      'Extended "Learn to play" lesson (promoted to prod, owner pass 5): adds the wind and ' +
      'club-selection cards the shipped lesson never covered, a contextual ' +
      'card the first time the player plays from rough/sand, a recovery card ' +
      'after a penalty, a step counter, and a one-time coin reward for ' +
      'finishing. Off = the shipped card set, unchanged.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — fold the extra cards in and remove the flag'
  },
  {
    key: 'resumeRound',
    description:
      'Unfinished-round resume (promoted to prod, owner pass 5): a plain solo round is ' +
      'checkpointed at each hole boundary (course, seed, hole, scores) and the ' +
      'landing offers "Finish the round" until it is completed, discarded, or ' +
      'goes stale. Aimed squarely at the interrupted first round — the one ' +
      'that gates every progressive-disclosure reward. Off = no checkpoint is ' +
      'ever written or read.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest-approved) — remove the flag once it has soaked'
  },
  {
    key: 'natureBatching',
    description:
      'Static-scatter batching (promoted to prod, owner pass 5): trees, tufts, blooms and ' +
      'bushes are drawn as thin instances grouped into spatial cells instead of ' +
      'one InstancedMesh scene node per prop. Same geometry, materials, ' +
      'positions and tints — the image is identical — but the per-frame ' +
      'world-matrix upload and the active-mesh walk over thousands of nodes ' +
      'both go away. Off = the classic per-prop instancing, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED to prod (playtest-approved on the device matrix) — make ' +
      'batching the sole planting path and remove the flag'
  },
  {
    key: 'driverOverswingNerf',
    description:
      'Tee-shot overpower fix: the DRIVER uses a negative overswing coefficient ' +
      '(SWING.driverOverswingBonus), so an overhit drive flies SHORTER than a ' +
      'flush strike instead of rocketing past target — the more you overswing the ' +
      'more distance you lose. Every other club keeps the shared positive ' +
      'overswing bonus. Off = the shipped behavior, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'PROMOTED to prod (playtest-approved) — bake the driver coefficient in and ' +
      'remove the flag'
  },
  {
    key: 'focusedGame',
    description:
      'THE STRIP-DOWN (promoted to prod, owner pass 5). The game had grown four ways to play a round ' +
      '(solo, 1v1, scramble, AI tournament), three ways to race somebody (ghost, ' +
      'rival, online tournament) and two tournament cadences — most of it aimed ' +
      'at a content library of 21 holes. On: solo golf only, one social feature ' +
      '(challenge a friend), the Hole of the Day with a rate-it survey, and a ' +
      'DAILY tournament in place of the weekly. The modes and systems are hidden ' +
      'rather than deleted, so the decision is reversible on a flag while it is ' +
      'being lived with. Off = everything as shipped.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen:
      'DECIDED — either the removals are made permanent (delete the modes, the ' +
      'rival and the ghost outright) or the flag comes out and the game keeps ' +
      'them. It must not linger as a permanent fork.'
  },
  {
    key: 'careerMode',
    description:
      'CAREER MODE: your Pro — a rookie golfer starting at overall 65 who ' +
      'grows because you played. Rounds pay CP (which replaced XP outright, ' +
      'and paces the season pass); CP buys attribute points in the Locker; ' +
      'the Pro is a sixth choice beside the five preset archetypes and the ' +
      'golfer you enter in the daily tournament. Off = no career card and no ' +
      'spend UI; CP still accrues silently (grow-only, so nothing is lost ' +
      'while the switch is thrown).',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED and soaked — remove once the career is the settled centre of progression'
  },
  {
    key: 'recordBoards',
    description:
      'LEADERBOARDS PER RECORD (promoted to prod, owner pass 5): longest drive, most holes-in-one, ' +
      'best average score, most chip-ins, and the rest of the career stats the ' +
      'profile already tracks — ranked across every player, not just your own ' +
      'personal bests. Reads the same world-readable /rounds node the admin ' +
      'dashboard aggregates, so it costs no new writes on any gameplay path. ' +
      'Off = Records shows only your own rounds, as it does today.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED once the boards have been watched on real traffic'
  }
];

const DEFS_BY_KEY = new Map(FLAG_DEFS.map((d) => [d.key, d]));

/** Admins may override flags in any environment; dev may always override. */
let allowOverrides = !ENV.isProd;

/**
 * Grant flag-override power for this session (called once the signed-in user is
 * confirmed to be an admin). Lets an admin flip a flag on the live site without
 * exposing the channel to normal players.
 */
export function enableFlagOverrides(isAdmin: boolean): void {
  if (isAdmin) allowOverrides = true;
}

function readOverride(key: string): boolean | null {
  if (!allowOverrides) return null;
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get(`ff.${key}`);
      if (q === 'on') return true;
      if (q === 'off') return false;
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(`ff.${key}`);
      if (s === 'on') return true;
      if (s === 'off') return false;
    }
  } catch {
    /* storage/URL unavailable — fall through to the default */
  }
  return null;
}

/**
 * Systems the strip-down switches off wholesale.
 *
 * `focusedGame` is not a feature of its own — it is the decision to stop
 * shipping three parallel opponent systems for a 21-hole game. Composing it
 * here rather than at each of the dozen call sites means the removal cannot be
 * half-applied: there is no path where the rival is off but its invite handler
 * is still armed. One level deep by construction, since `focusedGame` itself is
 * not in the set.
 */
const SUPERSEDED_BY_FOCUS = new Set(['rival', 'ghostRace']);

/** Resolve a flag to its effective boolean for this environment + overrides. */
export function flag(key: string): boolean {
  if (SUPERSEDED_BY_FOCUS.has(key) && flag('focusedGame')) return false;
  const def = DEFS_BY_KEY.get(key);
  if (!def) {
    // An unknown key is a programming error; fail safe to OFF rather than throw
    // on a hot path.
    if (!ENV.isProd) console.warn(`[flags] unknown flag "${key}" — defaulting off`);
    return false;
  }
  const override = readOverride(key);
  if (override !== null) return override;
  return ENV.isProd ? def.defaults.prod : def.defaults.dev;
}

/** Persist a sticky override (admin dev tooling). Pass null to clear it. */
export function setFlagOverride(key: string, value: boolean | null): void {
  if (!allowOverrides || typeof localStorage === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(`ff.${key}`);
    else localStorage.setItem(`ff.${key}`, value ? 'on' : 'off');
  } catch {
    /* ignore — overrides are best-effort */
  }
}

/** Snapshot of every flag's effective value (for a dev/admin flags panel). */
export function allFlags(): Array<{ def: FlagDef; value: boolean }> {
  return FLAG_DEFS.map((def) => ({ def, value: flag(def.key) }));
}
