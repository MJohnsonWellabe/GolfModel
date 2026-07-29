/**
 * FEATS — the one long-term goal list, and every one of them shows a tracker.
 *
 * This replaces four overlapping systems (curated achievements, mastery stars'
 * round-scale goals, the daily challenge and the ad-hoc "next up" list on the
 * profile pane) with a single shape:
 *
 *     { id, name, desc, tier, cp, coins, progress(profile) => { have, need } }
 *
 * The important word is `progress`. The old achievements exposed only a boolean
 * `test`, so the UI could say "Make 25 birdies" and nothing else — a player 24
 * birdies in saw exactly what a player with none saw. Every feat here reports
 * where the player actually is, and the profile pane renders that with the same
 * `.xpBar` the season pass uses, so a goal is a bar you can watch fill rather
 * than a sentence you either have or have not satisfied (owner: "the challenges
 * need to be redone ... with trackers").
 *
 * TIERS. `starter` is met in a round or two, `pro` is a season's work, and
 * `legend` is the owner's hard tier — the four feats that need every course on
 * the roster to give something up:
 *
 *   −5 at every course · eagle the par 5 at every course ·
 *   ace the par 3 at every course · drive a par 4
 *
 * On a three-hole round "−5 at each course" is brutal by construction, which is
 * what was asked for: it means −5 across three holes (one par 4, one par 3, one
 * par 5), eight times over.
 *
 * IDS ARE PERMANENT. `profile.achievements` stores completed feat ids, so an id
 * reused with a different meaning would silently hand a player something they
 * never did, and a renamed id would take away something they did. Every feat
 * carried over from the achievement table keeps its original id.
 *
 * PURE. No DOM, no storage, no engine — `progress` reads the profile and
 * nothing else, so the same numbers drive the UI, the award loop
 * (ProgressionEngine) and the admin readout (admin/liveOps).
 */

import type { PlayerProfile } from '../profile/Profile';
import { careerOvr, emptyCareer } from '../data/career';
import { applyClubUpgrades } from '../data/storeCatalog';
import { starCount } from './Mastery';
import { hasGrandSlam, SEASON_LIMIT, TourProRecord } from './TourSeason';
import { COURSE_LIST } from '../data/courseRoster';

/** Every course a feat that says "each course" has to be done on. */
export const FEAT_COURSE_IDS: readonly string[] = COURSE_LIST.map((c) => c.id);

export type FeatTier = 'starter' | 'pro' | 'legend';

export interface FeatProgress {
  /** Where the player is. Never above `need`. */
  have: number;
  /** Where they have to get to. Always >= 1. */
  need: number;
}

export interface Feat {
  id: string;
  name: string;
  desc: string;
  tier: FeatTier;
  /** Career Points paid once, the first time it completes. */
  cp: number;
  coins: number;
  progress: (p: PlayerProfile) => FeatProgress;
}

/** True once a feat's tracker is full. The award loop and the UI share it, so
 *  "the bar is full" and "it paid out" can never disagree. */
export function featDone(f: Feat, p: PlayerProfile): boolean {
  const { have, need } = f.progress(p);
  return have >= need;
}

/**
 * PER-COURSE FEAT LEDGER.
 *
 * Three of the four legend feats ask "on which courses have you done this",
 * and nothing in the profile could answer that: `CareerStats` counts eagles
 * lifetime, `PersonalRecords` keeps a best per course but not what shape it
 * was, and the mastery bitmask is per hole but does not distinguish an eagle
 * from a birdie. So they get their own ledger — three sets of course ids, and
 * nothing else.
 *
 * Sets, not counters, because the question is "which", and because a set merges
 * across devices by union with no way to double-count (see {@link mergeFeats}).
 */
export interface FeatState {
  v: 1;
  /** Course ids whose par 5 has been eagled (or better). */
  eagledPar5: string[];
  /** Course ids whose par 3 has been aced. */
  acedPar3: string[];
  /** Course ids where a par 4 tee shot finished on the green. */
  drivenPar4: string[];
}

export function emptyFeats(): FeatState {
  return { v: 1, eagledPar5: [], acedPar3: [], drivenPar4: [] };
}

/** Course ids only, deduped, and only ones still on the roster — a course that
 *  left the game must not hold a "each course" feat open forever. */
function cleanIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(FEAT_COURSE_IDS);
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && known.has(v)))].sort();
}

export function migrateFeats(raw: unknown): FeatState {
  const r = (raw ?? {}) as Partial<FeatState>;
  return {
    v: 1,
    eagledPar5: cleanIds(r.eagledPar5),
    acedPar3: cleanIds(r.acedPar3),
    drivenPar4: cleanIds(r.drivenPar4)
  };
}

/** Union — grow-only, exactly like every other record in the profile. A feat
 *  earned on a phone and a feat earned on a laptop both count. */
export function mergeFeats(a: FeatState | undefined, b: FeatState | undefined): FeatState {
  const ma = migrateFeats(a);
  const mb = migrateFeats(b);
  const union = (x: string[], y: string[]): string[] => [...new Set([...x, ...y])].sort();
  return {
    v: 1,
    eagledPar5: union(ma.eagledPar5, mb.eagledPar5),
    acedPar3: union(ma.acedPar3, mb.acedPar3),
    drivenPar4: union(ma.drivenPar4, mb.drivenPar4)
  };
}

/**
 * Record what a finished hole proved, if anything. Called once per hole of the
 * human's round, from the same place the mastery stars are folded in.
 *
 * Returns a NEW state when something changed and the same object when it did
 * not, so the caller can skip a write on the overwhelmingly common hole where
 * nothing legendary happened.
 */
export function recordHoleFeats(
  s: FeatState,
  hole: { courseId: string; par: number; strokes: number; droveGreen: boolean }
): FeatState {
  const add = (list: string[]): string[] =>
    list.includes(hole.courseId) ? list : [...list, hole.courseId].sort();
  let out = s;
  const bump = (key: 'eagledPar5' | 'acedPar3' | 'drivenPar4'): void => {
    const next = add(out[key]);
    if (next !== out[key]) out = { ...out, [key]: next };
  };
  if (!FEAT_COURSE_IDS.includes(hole.courseId) || hole.strokes <= 0) return s;
  // Eagle or better — an albatross on a par 5 is a 2, and it would be perverse
  // for the better score not to count.
  if (hole.par === 5 && hole.strokes <= hole.par - 2) bump('eagledPar5');
  if (hole.par === 3 && hole.strokes === 1) bump('acedPar3');
  if (hole.par === 4 && hole.droveGreen) bump('drivenPar4');
  return out;
}

/* ------------------------------------------------------------------------ */
/* The list                                                                  */
/* ------------------------------------------------------------------------ */

const feats = (p: PlayerProfile): FeatState => migrateFeats(p.retention?.feats);
const mastery = (p: PlayerProfile): Parameters<typeof starCount>[0] =>
  p.retention?.mastery ?? { v: 1, stars: {} };

/** A one-shot feat: done or not, rendered as a 0/1 bar. */
const once = (done: (p: PlayerProfile) => boolean) => (p: PlayerProfile): FeatProgress => ({
  have: done(p) ? 1 : 0,
  need: 1
});

/** A counter feat: how far along a target. Clamped so a tracker never reads
 *  "30 / 25" once the target is passed. */
const upTo =
  (need: number, have: (p: PlayerProfile) => number) =>
  (p: PlayerProfile): FeatProgress => ({ have: Math.max(0, Math.min(need, Math.floor(have(p)))), need });

/**
 * The best overall across the stable, **as the game displays it** — base
 * attributes plus what the purchased clubs add.
 *
 * This used to be `bestProOvr(career)`, which reads the BASE attributes only,
 * and that made "The Zenith" (99 overall) unwinnable for anybody who had
 * bought a driver. `career.raiseAttr` refuses a point once
 * `base + upgradeStatBonus >= 100`, because past that the engine's clamp means
 * the point buys nothing — correct on its own terms, but it caps the BASE
 * power/accuracy at `100 - 3 * tier`. So a fully maxed Pro reads 98 with a
 * tier-1 driver and 97 with a tier-2 (owner: "the achievement for maxing a pro
 * at 99 overall is impossible with the upgrades ... my guy is only 97 even
 * though he's maxed in everything"). Buying an upgrade permanently destroyed a
 * feat, account-wide.
 *
 * It also meant one Pro had two different overalls on screen at once: the
 * Locker card already shows `ovr(applyClubUpgrades(...))`, the hub showed the
 * base. Grading on the effective number fixes the feat and settles that
 * disagreement in favour of the one the player is shown on their own card.
 */
function bestProOvrEffective(p: PlayerProfile): number {
  const pros = (p.career ?? emptyCareer()).pros;
  return pros.reduce(
    (best, pro) => Math.max(best, careerOvr(applyClubUpgrades(pro.attrs, p.clubUpgrades ?? {}))),
    0
  );
}

/** The best any single Pro has done on one record-book counter. Career feats
 *  are per-GOLFER ("4 majors with one Pro"), never a lifetime total across a
 *  stable of them. */
function bestTourStat(p: PlayerProfile, pick: (r: TourProRecord) => number): number {
  const recs = Object.values(p.tourHistory ?? {});
  return recs.length ? Math.max(...recs.map(pick)) : 0;
}

/** How many courses have a personal best of `toPar` or lower. */
function coursesUnder(p: PlayerProfile, toPar: number): number {
  const best = p.retention?.records?.bestByCourse ?? {};
  return FEAT_COURSE_IDS.filter((id) => (best[id]?.toPar ?? 0) <= toPar).length;
}

const ALL = FEAT_COURSE_IDS.length;

export const FEATS: Feat[] = [
  /* -- starter: the first of each thing, met inside a round or two ---------- */
  { id: 'first_birdie', name: 'First Birdie', desc: 'Make your first birdie', tier: 'starter', cp: 2, coins: 25, progress: once((p) => p.stats.birdies >= 1) },
  { id: 'first_eagle', name: 'First Eagle', desc: 'Make your first eagle', tier: 'starter', cp: 4, coins: 50, progress: once((p) => p.stats.eagles >= 1) },
  { id: 'first_ace', name: 'Hole-in-One!', desc: 'Record a hole-in-one', tier: 'starter', cp: 10, coins: 100, progress: once((p) => p.stats.holeInOnes >= 1) },
  { id: 'deep_red', name: 'Deep Red', desc: 'Finish a round 3 under par or better', tier: 'starter', cp: 6, coins: 75, progress: once((p) => (p.stats.bestRoundToPar ?? 0) <= -3) },
  { id: 'bomb_putt', name: 'Bomb Dropper', desc: 'Hole a putt from 30 feet', tier: 'starter', cp: 4, coins: 50, progress: upTo(30, (p) => p.stats.longestPuttFt) },
  { id: 'big_stick', name: 'Big Stick', desc: 'Drive one 320 yards', tier: 'starter', cp: 4, coins: 50, progress: upTo(320, (p) => p.stats.longestDriveYds) },

  /* -- pro: a season's worth of play --------------------------------------- */
  { id: 'birdies_25', name: 'Birdie Machine', desc: 'Make 25 birdies', tier: 'pro', cp: 4, coins: 50, progress: upTo(25, (p) => p.stats.birdies) },
  { id: 'chip_ins_10', name: 'Short-Game Wizard', desc: 'Hole out from off the green 10 times', tier: 'pro', cp: 6, coins: 75, progress: upTo(10, (p) => p.stats.chipIns) },
  { id: 'rounds_25', name: 'Regular', desc: 'Play 25 rounds', tier: 'pro', cp: 4, coins: 50, progress: upTo(25, (p) => p.stats.rounds) },
  { id: 'fire_5', name: 'Blazing', desc: 'Reach a 5-swing Fire streak', tier: 'pro', cp: 6, coins: 75, progress: upTo(5, (p) => p.retention?.records?.longestFireStreak ?? 0) },
  { id: 'streak_7', name: 'Committed', desc: 'Play 7 days in a row', tier: 'pro', cp: 4, coins: 50, progress: upTo(7, (p) => Math.max(p.dailyStreak, p.retention?.streak?.best ?? 0)) },
  { id: 'stars_18', name: 'Constellation', desc: 'Earn 18 mastery stars', tier: 'pro', cp: 8, coins: 100, progress: upTo(18, (p) => starCount(mastery(p))) },
  // Was hardcoded to four of the eight courses, so the four newest could never
  // satisfy it. It asks the same question of every course on the roster now.
  { id: 'course_master', name: 'Course Master', desc: 'Earn all 9 mastery stars on one course', tier: 'pro', cp: 8, coins: 100, progress: upTo(9, (p) => Math.max(0, ...FEAT_COURSE_IDS.map((c) => starCount(mastery(p), c)))) },
  { id: 'under_par_all', name: 'Round the Roster', desc: `Finish under par at all ${ALL} courses`, tier: 'pro', cp: 10, coins: 125, progress: upTo(ALL, (p) => coursesUnder(p, -1)) },
  { id: 'career_80', name: 'Rising Star', desc: 'Raise a Pro to 80 overall', tier: 'pro', cp: 6, coins: 75, progress: upTo(80, (p) => bestProOvrEffective(p)) },
  { id: 'career_90', name: 'World Class', desc: 'Raise a Pro to 90 overall', tier: 'pro', cp: 10, coins: 100, progress: upTo(90, (p) => bestProOvrEffective(p)) },
  { id: 'win_tournament', name: 'Champion', desc: 'Win a tournament', tier: 'pro', cp: 8, coins: 100, progress: once((p) => p.stats.tournamentWins >= 1) },
  { id: 'first_major', name: 'Major Winner', desc: 'Win your first major championship', tier: 'pro', cp: 12, coins: 150, progress: once((p) => bestTourStat(p, (r) => r.majorWins) >= 1) },
  { id: 'season_champion', name: 'Season Champion', desc: 'Top the Tour Season points table', tier: 'pro', cp: 12, coins: 150, progress: once((p) => (p.stats.seasonChampionships ?? 0) >= 1) },

  /* -- legend: the owner's hard tier --------------------------------------- */
  // Three holes, one of each par. Eight times over.
  { id: 'minus5_all_courses', name: 'Five Under, Everywhere', desc: `Shoot 5 under or better at all ${ALL} courses`, tier: 'legend', cp: 40, coins: 500, progress: upTo(ALL, (p) => coursesUnder(p, -5)) },
  { id: 'eagle_every_par5', name: 'The Eagle Circuit', desc: `Eagle the par 5 at all ${ALL} courses`, tier: 'legend', cp: 30, coins: 400, progress: upTo(ALL, (p) => feats(p).eagledPar5.length) },
  { id: 'ace_every_par3', name: 'The Ace Circuit', desc: `Ace the par 3 at all ${ALL} courses`, tier: 'legend', cp: 60, coins: 750, progress: upTo(ALL, (p) => feats(p).acedPar3.length) },
  { id: 'drive_a_par4', name: 'Driveable', desc: 'Drive a par 4 green off the tee', tier: 'legend', cp: 20, coins: 250, progress: once((p) => feats(p).drivenPar4.length >= 1) },
  { id: 'career_99', name: 'The Zenith', desc: 'Max a Pro at 99 overall', tier: 'legend', cp: 16, coins: 200, progress: upTo(99, (p) => bestProOvrEffective(p)) },
  { id: 'majors_4', name: 'Major Force', desc: 'Win 4 majors with one Pro', tier: 'legend', cp: 24, coins: 300, progress: upTo(4, (p) => bestTourStat(p, (r) => r.majorWins)) },
  { id: 'tour_wins_10', name: 'Tour Veteran', desc: 'Win 10 tour events with one Pro', tier: 'legend', cp: 20, coins: 250, progress: upTo(10, (p) => bestTourStat(p, (r) => r.wins)) },
  { id: 'grand_slam', name: 'Career Grand Slam', desc: 'Win all four majors with one Pro', tier: 'legend', cp: 40, coins: 500, progress: upTo(4, (p) => Math.max(0, ...Object.values(p.tourHistory ?? {}).map((r) => (hasGrandSlam(r) ? 4 : Math.min(3, r.majorWins))))) },
  { id: 'hall_of_fame', name: 'Hall of Fame', desc: `Play out all ${SEASON_LIMIT} seasons with one Pro`, tier: 'legend', cp: 32, coins: 400, progress: upTo(SEASON_LIMIT, (p) => bestTourStat(p, (r) => r.seasons.length)) }
];

/**
 * Feat ids that no longer exist, so the profile pane can ignore them in
 * `profile.achievements` rather than rendering a blank row.
 *
 * `wins_10` ("Win 10 head-to-head rounds") is here because `CareerStats.wins`
 * only increments in 1v1, and the `focusedGame` flag hides 1v1 — it was
 * unreachable, advertised, and had been for as long as the flag has been on.
 */
export const RETIRED_FEAT_IDS: readonly string[] = ['wins_10'];

export function featById(id: string): Feat | undefined {
  return FEATS.find((f) => f.id === id);
}

/** Tier order for display: what you can do next, before what you may never do. */
export const FEAT_TIERS: readonly { id: FeatTier; label: string }[] = [
  { id: 'starter', label: 'Getting started' },
  { id: 'pro', label: 'The long game' },
  { id: 'legend', label: 'Legendary' }
];
