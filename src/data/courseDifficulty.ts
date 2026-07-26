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
 * DERIVATION (2026-07, re-run with `node scripts/calibrate-tour-field.mjs`
 * after any physics/course change): target winning score per course
 * W = −3 − clamp((|expertAnchor| − 1.1) / 2.4, 0, 1), where expertAnchor is
 * the modeled-human expert mean toPar (the difficultyAnchors measurement) —
 * so a course the PLAYER finds hard (Wildwood, anchor −1.13) wins at ~−3
 * and a course the player scores freely on (Red Hollow, −3.45) wins at ~−4.
 * Easing = bootstrapped E[best of the 10-rival field] at easing 0 minus W.
 * Pinned by tests/simulation/tourFieldCalibration.test.ts.
 */
export const COURSE_FIELD_EASING: Record<string, number> = {
  sablebay: 0.4,
  wildwood: 0.5,
  timberline: 0.6,
  portjohnson: 0.5,
  redhollow: -0.1,
  wildvalley: 1.1,
  maplevale: 1.4,
  timberlinewest: -0.1
};

/** Unknown/generated course ids (the daily hole theme, builder previews). */
export const COURSE_FIELD_EASING_DEFAULT = 0.5;

export function fieldEasingFor(courseId: string): number {
  return COURSE_FIELD_EASING[courseId] ?? COURSE_FIELD_EASING_DEFAULT;
}
