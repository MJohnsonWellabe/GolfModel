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

describe('default course is Sable Bay', () => {
  it('the default id resolves to a real course named Sable Bay', () => {
    expect(DEFAULT_COURSE_ID).toBe('sablebay');
    expect(COURSES[DEFAULT_COURSE_ID]).toBeTruthy();
    expect(COURSES[DEFAULT_COURSE_ID].name).toBe('Sable Bay');
  });

  it('falls back to Sable Bay when no course is selected (first launch)', () => {
    expect(courseOrDefault(undefined, COURSES)).toBe(COURSES.sablebay);
    expect(courseOrDefault(null, COURSES)).toBe(COURSES.sablebay);
    expect(courseIdOrDefault(undefined, COURSES)).toBe('sablebay');
  });

  it('falls back to Sable Bay for an invalid/renamed saved course', () => {
    expect(courseOrDefault('not-a-course', COURSES)).toBe(COURSES.sablebay);
    expect(courseOrDefault('', COURSES)).toBe(COURSES.sablebay);
    expect(courseIdOrDefault('gone', COURSES)).toBe('sablebay');
  });

  it('PRESERVES a valid explicitly-chosen course rather than overriding it', () => {
    for (const id of Object.keys(COURSES)) {
      expect(courseOrDefault(id, COURSES)).toBe(COURSES[id]);
      expect(courseIdOrDefault(id, COURSES)).toBe(id);
    }
  });
});
