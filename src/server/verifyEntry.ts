/**
 * Server-side verification entry point.
 *
 * This is the ONLY module bundled for Cloud Functions
 * (`scripts/build-verify-bundle.mjs` → `functions/verifyRound.bundle.cjs`). It
 * deliberately pulls in nothing but the pure systems: physics, course data and
 * the replay. No Babylon, no DOM, no Firebase — the bundle is a few hundred KB
 * of arithmetic and JSON.
 *
 * The course roster is imported directly rather than read from the database, so
 * the server verifies against the courses it was DEPLOYED with. That is the
 * correct behaviour: a course edited after a round was played must not silently
 * change whether that round verifies. When courses change, redeploy — and the
 * `rosterVersion` returned with every result records which roster judged it.
 */

import { verifyRecording, VerifyResult } from '../systems/RoundVerify';
import type { ReplayOptions } from '../systems/RoundReplay';
import { COURSE_LIST, coursesFor } from '../data/courseRoster';

/**
 * Replay flags. These MUST match how production actually plays, or honest
 * rounds will be rejected: pins come from the authored sets (`layouts`) and the
 * bounded world is live in production (`boundedWorld`). Both are prod:true.
 */
const PRODUCTION_REPLAY: ReplayOptions = {
  useAuthoredPins: true,
  bounded: true
};

export interface VerifyRequest {
  recording: unknown;
}

export interface VerifyResponse extends VerifyResult {
  /** Which course roster judged this submission (for auditing a dispute). */
  rosterVersion: string;
}

const COURSES = coursesFor({ newCourses: true, courseRebuilds: true });
const ROSTER_VERSION = COURSE_LIST.map((c) => c.id).join(',');

export function verify(req: VerifyRequest): VerifyResponse {
  const result = verifyRecording(req.recording, COURSES, PRODUCTION_REPLAY);
  return { ...result, rosterVersion: ROSTER_VERSION };
}
