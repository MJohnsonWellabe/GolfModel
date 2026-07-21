import { CourseData } from '../core/types';

/**
 * The course used whenever no VALID course is otherwise chosen — first launch,
 * a missing/invalid saved or requested course, and every mode/tournament
 * fallback. A valid explicit selection is ALWAYS preserved; Wildwood is only
 * the fallback. Centralised here so "the default course" is decided in exactly
 * one place and can be unit-tested without booting the 3D app.
 */
export const DEFAULT_COURSE_ID = 'wildwood';

/**
 * Resolve a course id to its CourseData, falling back to the default course
 * when the id is absent or not in the roster (a corrupt/renamed saved course).
 * A valid id is always kept.
 */
export function courseOrDefault(
  id: string | undefined | null,
  courses: Record<string, CourseData>
): CourseData {
  return (id != null && courses[id]) || courses[DEFAULT_COURSE_ID];
}

/**
 * Resolve to a VALID course id — the given one when it exists in the roster,
 * otherwise the default. Use where a string id (not the CourseData) is needed.
 */
export function courseIdOrDefault(
  id: string | undefined | null,
  courses: Record<string, CourseData>
): string {
  return id != null && courses[id] ? id : DEFAULT_COURSE_ID;
}
