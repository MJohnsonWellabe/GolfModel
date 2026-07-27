/**
 * PER-COURSE FIELD EASING — strokes/round the AI tournament field HANDS BACK
 * on each course (subtracted from the tier form shift in
 * AiTournament.simulateEntrantRound).
 *
 * WHY (owner pass 8): "Each pro tourney I've played so far multiple people
 * have shot 4 under. The tourneys should be winnable at 3-4 under. Three on
 * a tough course with tough conditions. 4 on a more mild course." The round
 * simulator's difficulty ORDERING for AI golfers does not match a human's —
 * Maple Vale plays easy for the sim and hard for a person — so one global
 * shift can't land the winning score everywhere. This table is the
 * per-course correction.
 *
 * DERIVATION (re-run with `node scripts/calibrate-tour-field.mjs` after any
 * physics/course change): target winning score per course
 * W = −3 − clamp((|expertAnchor| − 1.1) / 2.4, 0, 1), where expertAnchor is
 * the modeled-human expert mean toPar (the difficultyAnchors measurement) —
 * so a course the PLAYER finds hard (Wildwood, anchor −1.13) wins at ~−3
 * and a course the player scores freely on (Red Hollow, −3.45) wins at ~−4.
 * Easing = bootstrapped E[best of the 10-rival field] at easing 0 minus W.
 *
 * PASS 9: every entry then moved 0.25 DEEPER (and Timberline West a further
 * 0.45, which was measurably out of band). The single-round W formula is not
 * the binding gate any more — the owner's is the MAJOR: "the rex or legend
 * should be about -10.0 instead of -9.3 on average in a major. it should be
 * hard to win." Majors measured -9.30 on the W formula alone, and a quarter
 * stroke per round is exactly the three quarters of a stroke a 3-round major
 * needed. Single rounds now win at about -3.3 (player-tough) to -4.2
 * (player-mild), which is still the "winnable at 3-4 under" the earlier pass
 * asked for. Pinned by tests/simulation/tourFieldCalibration.test.ts and
 * tourConsistency.test.ts.
 *
 * PASS 11 (the field rebalance — see docs/26_SCALE_PASS.md §31). The owner
 * asked for two more rivals at Rex's level and two more at Mei's, which took
 * the top of the field from TWO contenders to SIX. Nothing about a course
 * changed, but the winning score did: the best of six near-equal golfers beats
 * the best of two by roughly 0.6 strokes a round, so every single round was
 * being won at about −4.2 instead of −3.5 and every major at −11.4 instead of
 * −9.7. Each entry below therefore gained its OWN measured delta (+0.45 to
 * +0.98, the depth that course lost), which puts the per-course winning score
 * back on the numbers pass 9 signed off on and leaves the streak-free major at
 * about −9.5. HOT STREAKS then take the major the rest of the way: a rival
 * playing +5 above their level roughly a third of the time is worth another
 * ~0.7, landing the number the player actually sees at ≈ −10.
 */
export const COURSE_FIELD_EASING: Record<string, number> = {
  sablebay: 0.74,
  wildwood: 0.67,
  timberline: 0.9,
  portjohnson: 0.7,
  redhollow: 0.31,
  wildvalley: 1.41,
  maplevale: 1.75,
  timberlinewest: 0.18
};

/** Unknown/generated course ids (the daily hole theme, builder previews). */
export const COURSE_FIELD_EASING_DEFAULT = 0.5;

export function fieldEasingFor(courseId: string): number {
  return COURSE_FIELD_EASING[courseId] ?? COURSE_FIELD_EASING_DEFAULT;
}
