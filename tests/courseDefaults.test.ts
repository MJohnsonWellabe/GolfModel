import { describe, expect, it } from 'vitest';
import { CourseAuthoring, loadCourse } from '../src/data/courseLoader';
import { courseIdOrDefault, courseOrDefault, DEFAULT_COURSE_ID } from '../src/data/courseDefaults';
import { CourseData } from '../src/core/types';
import wildwood from '../src/data/courses/wildwood.json';
import sablebay from '../src/data/courses/sablebay.json';
import timberline from '../src/data/courses/timberline.json';
import portjohnson from '../src/data/courses/portjohnson.json';

const COURSES: Record<string, CourseData> = {
  wildwood: loadCourse(wildwood as unknown as CourseAuthoring),
  sablebay: loadCourse(sablebay as unknown as CourseAuthoring),
  timberline: loadCourse(timberline as unknown as CourseAuthoring),
  portjohnson: loadCourse(portjohnson as unknown as CourseAuthoring)
};

describe('default course is Wildwood', () => {
  it('the default id resolves to a real course named Wildwood Glen', () => {
    expect(DEFAULT_COURSE_ID).toBe('wildwood');
    expect(COURSES[DEFAULT_COURSE_ID]).toBeTruthy();
    expect(COURSES[DEFAULT_COURSE_ID].name).toBe('Wildwood Glen');
  });

  it('falls back to Wildwood when no course is selected (first launch)', () => {
    expect(courseOrDefault(undefined, COURSES)).toBe(COURSES.wildwood);
    expect(courseOrDefault(null, COURSES)).toBe(COURSES.wildwood);
    expect(courseIdOrDefault(undefined, COURSES)).toBe('wildwood');
  });

  it('falls back to Wildwood for an invalid/renamed saved course', () => {
    expect(courseOrDefault('not-a-course', COURSES)).toBe(COURSES.wildwood);
    expect(courseOrDefault('', COURSES)).toBe(COURSES.wildwood);
    expect(courseIdOrDefault('gone', COURSES)).toBe('wildwood');
  });

  it('PRESERVES a valid explicitly-chosen course rather than overriding it', () => {
    for (const id of Object.keys(COURSES)) {
      expect(courseOrDefault(id, COURSES)).toBe(COURSES[id]);
      expect(courseIdOrDefault(id, COURSES)).toBe(id);
    }
  });
});
