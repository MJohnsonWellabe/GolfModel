/**
 * The course roster — which courses exist, what they are called, and which JSON
 * each one actually loads.
 *
 * This used to live inline in `slice3d/main.ts`. It moved here for one hard
 * reason: the server-side score verifier has to build the SAME roster from the
 * SAME JSON, and it cannot import main.ts — that would drag Babylon, the DOM
 * and Firebase into a Cloud Function. Everything in this module is pure data
 * plus `loadCourse`, so it bundles to a few hundred KB of arithmetic and JSON
 * and runs unchanged in Node.
 *
 * Flags are PARAMETERS rather than reads, for the same reason: the server has no
 * flag registry, and it must be explicit about which roster it is judging a
 * submitted round against.
 */

import { CourseAuthoring, loadCourse } from './courseLoader';
import { withWildwoodPerf } from '../systems/wildwoodPerf';
import type { CourseData } from '../core/types';

import wildwood from './courses/wildwood.json';
import sablebay from './courses/sablebay.json';
import timberline from './courses/timberline.json';
import portjohnson from './courses/portjohnson.json';
import redhollow from './courses/redhollow.json';
import wildvalley from './courses/wildvalley.json';
import sablebayV2 from './courses/v2/sablebay.json';
import timberlineV2 from './courses/v2/timberline.json';
import timberlineWestV2 from './courses/v2/timberlinewest.json';
import portjohnsonV2 from './courses/v2/portjohnson.json';

export interface RosterFlags {
  /** V2 content expansion: Red Hollow + Wild Prairie join the roster. */
  newCourses: boolean;
  /** Rebuilt v2 variants replace the shipped originals, and Timberline West
   *  joins as a new course. */
  courseRebuilds: boolean;
  /** Wildwood's visuals-only render thinning. Never changes GEOMETRY, so it has
   *  no bearing on physics or verification — defaulted off for the server. */
  wildwoodPerf?: boolean;
}

export interface RosterEntry {
  id: string;
  name: string;
  tag: string;
  icon: string;
  art: string;
  difficulty: string;
}

/** Full roster metadata (id → display + one-line character). */
export function rosterFor(flags: RosterFlags): RosterEntry[] {
  const rebuilds = flags.courseRebuilds;
  return [
    { id: 'wildwood', name: 'Wildwood Glen', tag: 'Parkland · creeks & ponds, tight woods, wildflower beds', icon: '🌳', art: 'marketing/img/wildwood-cherry.png', difficulty: 'Balanced' },
    { id: 'sablebay', name: 'Sable Bay', tag: 'Coastal · water everywhere, waste sand, a true island green', icon: '🌊', art: 'marketing/img/sablebay-island.png', difficulty: 'Daring' },
    // Under courseRebuilds the v2 rebuild is branded "Timberline East" and a
    // sibling "Timberline West" joins; in production the id stays "timberline".
    { id: 'timberline', name: rebuilds ? 'Timberline East' : 'Timberline', tag: 'Forest · granite doglegs, a downhill tarn, a two-route par 5', icon: '🌲', art: 'marketing/img/timberline-pond.png', difficulty: 'Tight' },
    ...(rebuilds
      ? [{ id: 'timberlinewest', name: 'Timberline West', tag: 'Forest · a pine-alley dogleg, a tree-ringed hollow, a dogleg-right gauntlet', icon: '🌲', art: 'marketing/img/timberline-pond.png', difficulty: 'Tight' }]
      : []),
    { id: 'portjohnson', name: 'Port Johnson Links', tag: 'Links · treeless, windy, revetted pots by the sea', icon: '🏴', art: 'marketing/img/portjohnson-bunker.png', difficulty: 'Windy' },
    { id: 'redhollow', name: 'Red Hollow', tag: 'Desert canyon · emerald fairways over red-rock carries', icon: '🏜️', art: 'marketing/img/redhollow-chasm.png', difficulty: 'Daring' },
    { id: 'wildvalley', name: 'Wild Prairie', tag: 'Sand hills · golden fescue seas, bright ribbons, huge blowouts', icon: '🌾', art: 'marketing/img/wildvalley-blowout.png', difficulty: 'Rolling' }
  ];
}

/** Build the playable course map for a set of flags. */
export function coursesFor(flags: RosterFlags): Record<string, CourseData> {
  const rebuilds = flags.courseRebuilds;
  const REBUILDS: Record<string, unknown> = rebuilds
    ? { timberline: timberlineV2, sablebay: sablebayV2, portjohnson: portjohnsonV2 }
    : {};
  const src = (id: string, original: unknown): CourseAuthoring =>
    (REBUILDS[id] ?? original) as CourseAuthoring;
  const wildwoodSrc: unknown = flags.wildwoodPerf
    ? withWildwoodPerf(wildwood as unknown as CourseAuthoring)
    : wildwood;
  return {
    wildwood: loadCourse(src('wildwood', wildwoodSrc)),
    sablebay: loadCourse(src('sablebay', sablebay)),
    timberline: loadCourse(src('timberline', timberline)),
    portjohnson: loadCourse(src('portjohnson', portjohnson)),
    ...(rebuilds ? { timberlinewest: loadCourse(timberlineWestV2 as unknown as CourseAuthoring) } : {}),
    ...(flags.newCourses
      ? {
          redhollow: loadCourse(redhollow as unknown as CourseAuthoring),
          wildvalley: loadCourse(wildvalley as unknown as CourseAuthoring)
        }
      : {})
  };
}

/** Roster metadata for the fully-released set, for callers that only need ids
 *  and names (the server's audit string, tooling). */
export const COURSE_LIST: RosterEntry[] = rosterFor({ newCourses: true, courseRebuilds: true });
