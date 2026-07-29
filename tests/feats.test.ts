import { describe, expect, it } from 'vitest';
import {
  FEAT_COURSE_IDS,
  FEATS,
  FeatState,
  featById,
  featDone,
  emptyFeats,
  mergeFeats,
  migrateFeats,
  recordHoleFeats,
  RETIRED_FEAT_IDS
} from '../src/systems/Feats';
import { defaultProfile, mergeProfiles, PlayerProfile } from '../src/profile/Profile';

/**
 * FEATS replaced the achievement table, and the thing they add is the tracker.
 * So the gates here are mostly about `progress`: that it is monotonic, that it
 * never overshoots its own target, that it agrees with `featDone`, and that the
 * ledger behind the legend tier survives a migrate and a cross-device merge.
 */

describe('the feat list itself', () => {
  it('has unique ids and no retired one still in it', () => {
    const ids = FEATS.map((f) => f.id);
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
    for (const id of RETIRED_FEAT_IDS) expect(featById(id), `${id} is retired`).toBeUndefined();
  });

  it('every feat names itself, explains itself, and pays something', () => {
    for (const f of FEATS) {
      expect(f.name.length, f.id).toBeGreaterThan(0);
      expect(f.desc.length, f.id).toBeGreaterThan(0);
      expect(f.cp, f.id).toBeGreaterThan(0);
      expect(f.coins, f.id).toBeGreaterThan(0);
    }
  });

  it('reports a sane tracker on a brand-new profile — 0 of something, never done', () => {
    const p = defaultProfile();
    for (const f of FEATS) {
      const { have, need } = f.progress(p);
      expect(need, `${f.id} need`).toBeGreaterThanOrEqual(1);
      expect(have, `${f.id} have`).toBe(0);
      expect(featDone(f, p), `${f.id} must not fire on an empty profile`).toBe(false);
    }
  });

  it('never reports more progress than the target — no "30 / 25" bars', () => {
    const p = defaultProfile();
    // Absurd values on every counter a feat could read.
    p.stats = {
      ...p.stats,
      birdies: 9999,
      eagles: 9999,
      holeInOnes: 9999,
      chipIns: 9999,
      rounds: 9999,
      tournamentWins: 9999,
      seasonChampionships: 9999,
      longestDriveYds: 9999,
      longestPuttFt: 9999,
      bestRoundToPar: -99
    };
    p.dailyStreak = 9999;
    p.retention.records.longestFireStreak = 9999;
    for (const f of FEATS) {
      const { have, need } = f.progress(p);
      expect(have, `${f.id}`).toBeLessThanOrEqual(need);
    }
  });

  it('the "each course" feats target every course on the roster, not a hardcoded four', () => {
    const all = FEAT_COURSE_IDS.length;
    expect(all).toBeGreaterThanOrEqual(8);
    for (const id of ['minus5_all_courses', 'eagle_every_par5', 'ace_every_par3', 'under_par_all']) {
      expect(featById(id)!.progress(defaultProfile()).need, id).toBe(all);
    }
  });

  it('course_master asks for 9 stars on ONE course and can be satisfied by any of them', () => {
    const f = featById('course_master')!;
    const p = defaultProfile();
    // The old version only looked at four course ids, so a player who mastered
    // the newest course was told they had not.
    const newest = FEAT_COURSE_IDS[FEAT_COURSE_IDS.length - 1];
    p.retention.mastery.stars[`${newest}:1`] = 0b111;
    p.retention.mastery.stars[`${newest}:2`] = 0b111;
    p.retention.mastery.stars[`${newest}:3`] = 0b111;
    expect(f.progress(p)).toEqual({ have: 9, need: 9 });
    expect(featDone(f, p)).toBe(true);
  });
});

describe('the −5 tracker', () => {
  const withBests = (byCourse: Record<string, number>): PlayerProfile => {
    const p = defaultProfile();
    for (const [id, toPar] of Object.entries(byCourse)) {
      p.retention.records.bestByCourse[id] = { total: 12 + toPar, toPar, at: 1 };
    }
    return p;
  };

  it('counts only courses at −5 or better, and counts them all', () => {
    const f = featById('minus5_all_courses')!;
    expect(f.progress(withBests({ [FEAT_COURSE_IDS[0]]: -4 })).have).toBe(0);
    expect(f.progress(withBests({ [FEAT_COURSE_IDS[0]]: -5 })).have).toBe(1);
    expect(f.progress(withBests({ [FEAT_COURSE_IDS[0]]: -9 })).have).toBe(1);
    const all = Object.fromEntries(FEAT_COURSE_IDS.map((id) => [id, -5]));
    expect(featDone(f, withBests(all))).toBe(true);
  });

  it('under-par and −5 are different bars', () => {
    const p = withBests(Object.fromEntries(FEAT_COURSE_IDS.map((id) => [id, -1])));
    expect(featDone(featById('under_par_all')!, p)).toBe(true);
    expect(featDone(featById('minus5_all_courses')!, p)).toBe(false);
  });
});

describe('the per-course feat ledger', () => {
  const A = FEAT_COURSE_IDS[0];
  const B = FEAT_COURSE_IDS[1];

  it('records an eagle on the par 5, an ace on the par 3, a driven par 4', () => {
    let s = emptyFeats();
    s = recordHoleFeats(s, { courseId: A, par: 5, strokes: 3, droveGreen: false });
    s = recordHoleFeats(s, { courseId: A, par: 3, strokes: 1, droveGreen: false });
    s = recordHoleFeats(s, { courseId: A, par: 4, strokes: 3, droveGreen: true });
    expect(s.eagledPar5).toEqual([A]);
    expect(s.acedPar3).toEqual([A]);
    expect(s.drivenPar4).toEqual([A]);
  });

  it('an albatross counts as an eagle; a birdie does not', () => {
    expect(recordHoleFeats(emptyFeats(), { courseId: A, par: 5, strokes: 2, droveGreen: false }).eagledPar5).toEqual([A]);
    expect(recordHoleFeats(emptyFeats(), { courseId: A, par: 5, strokes: 4, droveGreen: false }).eagledPar5).toEqual([]);
  });

  it('a par 4 holed from the tee counts as driven, a par 4 not driven does not', () => {
    expect(recordHoleFeats(emptyFeats(), { courseId: A, par: 4, strokes: 1, droveGreen: true }).drivenPar4).toEqual([A]);
    expect(recordHoleFeats(emptyFeats(), { courseId: A, par: 4, strokes: 2, droveGreen: false }).drivenPar4).toEqual([]);
  });

  it('is idempotent — the same course twice is still one course', () => {
    let s = recordHoleFeats(emptyFeats(), { courseId: A, par: 3, strokes: 1, droveGreen: false });
    const before = s;
    s = recordHoleFeats(s, { courseId: A, par: 3, strokes: 1, droveGreen: false });
    expect(s.acedPar3).toEqual([A]);
    expect(s, 'nothing changed, so nothing was reallocated').toBe(before);
  });

  it('ignores an unfinished hole and an unknown course', () => {
    expect(recordHoleFeats(emptyFeats(), { courseId: A, par: 3, strokes: 0, droveGreen: false })).toEqual(emptyFeats());
    expect(recordHoleFeats(emptyFeats(), { courseId: 'nope', par: 3, strokes: 1, droveGreen: false })).toEqual(emptyFeats());
  });

  it('migrates junk to empty and drops courses that left the roster', () => {
    expect(migrateFeats(undefined)).toEqual(emptyFeats());
    expect(migrateFeats('nonsense')).toEqual(emptyFeats());
    const dirty = { v: 1, acedPar3: [A, 'retired_course', A, 7], eagledPar5: null, drivenPar4: undefined };
    expect(migrateFeats(dirty as unknown as FeatState).acedPar3).toEqual([A]);
  });

  it('merges by union — an ace on the phone and an ace on the laptop are two aces', () => {
    const phone: FeatState = { v: 1, eagledPar5: [], acedPar3: [A], drivenPar4: [] };
    const laptop: FeatState = { v: 1, eagledPar5: [B], acedPar3: [B], drivenPar4: [] };
    const m = mergeFeats(phone, laptop);
    expect(m.acedPar3).toEqual([A, B].sort());
    expect(m.eagledPar5).toEqual([B]);
    // ...and it survives the whole-profile merge, in both directions.
    const a = defaultProfile();
    const b = defaultProfile();
    a.retention.feats = phone;
    b.retention.feats = laptop;
    expect(mergeProfiles(a, b).retention.feats.acedPar3).toEqual([A, B].sort());
    expect(mergeProfiles(b, a).retention.feats.acedPar3).toEqual([A, B].sort());
  });

  it('drives the legend feats it exists for', () => {
    const p = defaultProfile();
    p.retention.feats = { v: 1, eagledPar5: [...FEAT_COURSE_IDS], acedPar3: [A], drivenPar4: [A] };
    expect(featDone(featById('eagle_every_par5')!, p)).toBe(true);
    expect(featById('ace_every_par3')!.progress(p)).toEqual({ have: 1, need: FEAT_COURSE_IDS.length });
    expect(featDone(featById('drive_a_par4')!, p)).toBe(true);
  });
});
