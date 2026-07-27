import { Golfer } from '../core/types';

/**
 * THE TOUR FIELD — ten named rivals who play every event of every season.
 *
 * Persistence is the point (owner Q&A: "~10 named persistent rivals"): the
 * same names accumulate season points beside yours, so "two behind Rex
 * Calloway" means something by event six. Each rival is tagged with one of
 * the existing FORM_SHIFT difficulty tiers so AiTournament's calibrated
 * score-shift math is reused verbatim — their stats set HOW the simulator
 * plays the holes, the tier sets the tournament form.
 *
 * THE FIELD IS TEN AND STAYS TEN. TOUR_POINTS pays exactly eleven finishers
 * (you plus ten), so an eleventh rival would play every week for nothing. Ids
 * are load-bearing too — they key `TourSeasonState.points`, `winnerId`, and
 * the stored per-event field scores a shared season re-settles from — so a
 * rival is RE-RATED in place, never replaced.
 *
 * THE 2026-07 REBALANCE (owner, verbatim): "Put 2 players at the level of rex
 * Callaway. Put 2 at the level of Mei Tanaka too. Make others a little better
 * too so no one is consistently awful."
 *
 * So the ladder was rebuilt rather than extended:
 *
 *   - SIX at the top instead of two. Dutch and Wren stepped up to Rex's level
 *     (95.2 / 95.0 / 94.8) and Sol and Lena to Mei's (94.4 / 94.2 / 94.0).
 *     They are deliberately a fraction apart rather than identical: entrantForm
 *     is a line in the rating, and two rivals sharing a rating would share a
 *     mean — the exact flatness the pass-9 identity work removed.
 *   - THE FLOOR CAME UP. Moss and Pip gained 5–6 overall and Gus and Baz 3–4,
 *     so the weakest man in the field is an 85.4 who shoots the odd good
 *     number, not an 80.4 who is reliably last by three shots. Measured on the
 *     same courses and seeds: +2.67 to par a round before, +0.96 after. And
 *     the spread survives — best-to-worst went from 5.38 strokes a round to
 *     3.67, against a per-round sd of ~1.05. The four of them keep real gaps
 *     from each other (89.8 / 88.6 / 87.8 / 85.4) so the bottom of the board
 *     is still a ladder and not a huddle.
 *
 * The difficulty tiers are the SHAPE of that ladder, not a verdict on the
 * golfer: "Easy" now means the bottom of a very good tour field.
 *
 * Hot streaks are NOT data here — they are derived per season from the seed
 * (AiTournament.hotStreakAt), so who catches fire is a story the season tells
 * rather than a permanent trait.
 */

export interface TourRival extends Golfer {
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Legend';
  tagline: string;
}

export const TOUR_RIVALS: TourRival[] = [
  {
    id: 'rex',
    name: 'Rex Calloway',
    color: 0xc0392b,
    character: 'knox',
    difficulty: 'Legend',
    tagline: 'Five-time season champion. Expects a sixth.',
    // 95.2 — the benchmark the rest of the top of the board is measured against.
    stats: { drivingPower: 97, drivingAccuracy: 93, approach: 96, chipping: 94, putting: 96 }
  },
  {
    id: 'dutch',
    name: 'Dutch Vanderberg',
    color: 0x2e86c1,
    character: 'cole',
    difficulty: 'Legend',
    // 95.0 — Rex's level. The aggression is unchanged; the execution caught up.
    tagline: 'Attacks every flag like it owes him money — and collects.',
    stats: { drivingPower: 96, drivingAccuracy: 92, approach: 97, chipping: 95, putting: 95 }
  },
  {
    id: 'wren',
    name: 'Wren Okafor',
    color: 0x16a085,
    character: 'wren',
    difficulty: 'Legend',
    // 94.8 — Rex's level, reached from the other end of the bag.
    tagline: 'Wedges like darts. Nobody gets up and down more often.',
    stats: { drivingPower: 88, drivingAccuracy: 94, approach: 96, chipping: 99, putting: 97 }
  },
  {
    id: 'mei',
    name: 'Mei Tanaka',
    color: 0x8e44ad,
    character: 'ivy',
    difficulty: 'Legend',
    tagline: 'Ice on the greens. Never three-putts twice.',
    // 94.4 — the second benchmark.
    stats: { drivingPower: 90, drivingAccuracy: 95, approach: 94, chipping: 95, putting: 98 }
  },
  {
    id: 'sol',
    name: 'Sol Njoku',
    color: 0xf39c12,
    character: 'dash',
    difficulty: 'Legend',
    // 94.2 — Mei's level. Still the longest carry on tour; the miss is smaller now.
    tagline: 'Longest carry on tour, and he finally trusts the wedges.',
    stats: { drivingPower: 100, drivingAccuracy: 89, approach: 94, chipping: 93, putting: 95 }
  },
  {
    id: 'lena',
    name: 'Lena Kowalski',
    color: 0x27ae60,
    character: 'bree',
    difficulty: 'Legend',
    // 94.0 — Mei's level. The grinder who stopped only grinding.
    tagline: 'Grinds out pars until somebody else blinks. Nobody blinks first.',
    stats: { drivingPower: 89, drivingAccuracy: 96, approach: 95, chipping: 94, putting: 96 }
  },
  {
    id: 'baz',
    name: 'Baz Romero',
    color: 0xd35400,
    character: 'enzo',
    difficulty: 'Hard',
    tagline: 'Fairways, greens, and absolutely no drama.',
    // 89.8 — best of the chasing pack.
    stats: { drivingPower: 88, drivingAccuracy: 93, approach: 91, chipping: 89, putting: 88 }
  },
  {
    id: 'gus',
    name: 'Gus Pemberton',
    color: 0x7f8c8d,
    character: 'theo',
    difficulty: 'Hard',
    tagline: 'Twenty seasons in. Knows every pin by name.',
    // 88.6 — course knowledge instead of speed.
    stats: { drivingPower: 83, drivingAccuracy: 91, approach: 91, chipping: 89, putting: 89 }
  },
  {
    id: 'pip',
    name: 'Pip Delacroix',
    color: 0xe27ad8,
    character: 'pia',
    difficulty: 'Medium',
    tagline: 'Rookie of the year — and the year is not over.',
    // 87.8 — the biggest single gain in the rebalance: a rookie who can now
    // contend on a good week instead of propping up the board.
    stats: { drivingPower: 90, drivingAccuracy: 85, approach: 88, chipping: 87, putting: 89 }
  },
  {
    id: 'moss',
    name: 'Moss Whitaker',
    color: 0x6d4c41,
    character: 'milo',
    difficulty: 'Easy',
    tagline: 'Big swing, bigger smile, and a much straighter driver.',
    // 85.4 — the weakest man in the field, and no longer a punchline: the
    // wildness was dialled back while the length was kept.
    stats: { drivingPower: 95, drivingAccuracy: 78, approach: 86, chipping: 84, putting: 84 }
  }
];
