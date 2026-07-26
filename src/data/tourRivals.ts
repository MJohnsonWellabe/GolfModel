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
 * The spread (~78–97 OVR, two Legends down to two Easys) makes the season a
 * real chase: the Legends usually top the points, but sd ~1.3–1.6 per round
 * means usually, not always — a hot player takes majors off them.
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
    stats: { drivingPower: 97, drivingAccuracy: 93, approach: 96, chipping: 94, putting: 96 }
  },
  {
    id: 'mei',
    name: 'Mei Tanaka',
    color: 0x8e44ad,
    character: 'ivy',
    difficulty: 'Legend',
    tagline: 'Ice on the greens. Never three-putts twice.',
    stats: { drivingPower: 90, drivingAccuracy: 95, approach: 94, chipping: 95, putting: 98 }
  },
  {
    id: 'dutch',
    name: 'Dutch Vanderberg',
    color: 0x2e86c1,
    character: 'cole',
    difficulty: 'Hard',
    tagline: 'Attacks every flag like it owes him money.',
    stats: { drivingPower: 92, drivingAccuracy: 85, approach: 92, chipping: 91, putting: 88 }
  },
  {
    id: 'sol',
    name: 'Sol Njoku',
    color: 0xf39c12,
    character: 'dash',
    difficulty: 'Hard',
    tagline: 'Longest carry on tour. The rough forgives him.',
    stats: { drivingPower: 99, drivingAccuracy: 80, approach: 89, chipping: 87, putting: 89 }
  },
  {
    id: 'wren',
    name: 'Wren Okafor',
    color: 0x16a085,
    character: 'wren',
    difficulty: 'Hard',
    tagline: 'Wedges like darts. Up-and-down from anywhere.',
    stats: { drivingPower: 84, drivingAccuracy: 88, approach: 90, chipping: 96, putting: 91 }
  },
  {
    id: 'baz',
    name: 'Baz Romero',
    color: 0xd35400,
    character: 'enzo',
    difficulty: 'Medium',
    tagline: 'Fairways, greens, and absolutely no drama.',
    stats: { drivingPower: 84, drivingAccuracy: 90, approach: 86, chipping: 84, putting: 85 }
  },
  {
    id: 'lena',
    name: 'Lena Kowalski',
    color: 0x27ae60,
    character: 'bree',
    difficulty: 'Medium',
    tagline: 'Grinds out pars until somebody else blinks.',
    stats: { drivingPower: 82, drivingAccuracy: 89, approach: 87, chipping: 86, putting: 88 }
  },
  {
    id: 'gus',
    name: 'Gus Pemberton',
    color: 0x7f8c8d,
    character: 'theo',
    difficulty: 'Medium',
    tagline: 'Twenty seasons in. Knows every pin by name.',
    stats: { drivingPower: 80, drivingAccuracy: 88, approach: 88, chipping: 85, putting: 86 }
  },
  {
    id: 'pip',
    name: 'Pip Delacroix',
    color: 0xe27ad8,
    character: 'pia',
    difficulty: 'Easy',
    tagline: 'Rookie of the year — the year is not over.',
    stats: { drivingPower: 86, drivingAccuracy: 78, approach: 82, chipping: 80, putting: 81 }
  },
  {
    id: 'moss',
    name: 'Moss Whitaker',
    color: 0x6d4c41,
    character: 'milo',
    difficulty: 'Easy',
    tagline: 'Big swing, bigger smile, occasional fairway.',
    stats: { drivingPower: 93, drivingAccuracy: 72, approach: 80, chipping: 78, putting: 79 }
  }
];
