// Deterministic course generator — the single command that rebuilds every
// generated course JSON. Re-running always reproduces the same files.
//
//   node scripts/gen-new-courses.mjs
//
// Structure (dev-environment roadmap restructure, 2026-07-20):
//   scripts/courselib.mjs      — shared authoring primitives + emit()
//   scripts/courses/<id>.mjs   — one deterministic module per course
//
// Two output tiers:
//   src/data/courses/<id>.json     — the expansion courses (redhollow,
//     wildvalley): dev roster behind the `newCourses` flag.
//   src/data/courses/v2/<id>.json  — TEARDOWN/REBUILD variants of the base
//     courses: replace the shipped originals in dev only, behind the
//     `courseRebuilds` flag. Production never loads them.
//
// Never hand-edit any emitted JSON (this script overwrites it), and never
// hand-edit a JSON to satisfy a test — fix the course module instead.
// Playability gates: tests/simulation/newCourses.test.ts (+ rebuild sims);
// geometry gates: tests/unit/{terrainPass,rockPass,boundary}.test.ts.
import { emit } from './courselib.mjs';
import { redhollow } from './courses/redhollow.mjs';
import { wildvalley } from './courses/wildvalley.mjs';
import { timberlineV2 } from './courses/timberline_v2.mjs';
import { sablebayV2 } from './courses/sablebay_v2.mjs';

// Expansion courses (newCourses flag).
emit(redhollow, 'redhollow');
emit(wildvalley, 'wildvalley');

// v2 teardown/rebuild variants (courseRebuilds flag) — added course by course
// as each rebuild lands.
emit(timberlineV2, 'timberline', 'src/data/courses/v2');
emit(sablebayV2, 'sablebay', 'src/data/courses/v2');
