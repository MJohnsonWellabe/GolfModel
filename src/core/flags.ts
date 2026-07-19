/**
 * Feature flags (V2 dev-environment foundation — see
 * docs/technical/DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md §Feature flags).
 *
 * A flag is a named switch with a per-environment default and, for admins, a
 * runtime override. Flags exist to ship incomplete or high-risk systems safely
 * and to act as kill switches — they are NOT permanent configuration. Every
 * flag declares an owner and a removal condition so the set never rots.
 *
 * This is separate from `src/core/debugFlags.ts`, which parses one-shot CAPTURE
 * params (?hole/?cam/?freeze) for the screenshot harness. Feature flags gate
 * product behavior; debug flags position a deterministic screenshot.
 *
 * Override precedence (highest first), admins only:
 *   1. URL query      ?ff.<key>=on|off       (this load only)
 *   2. localStorage    ff.<key> = "on"|"off"  (sticky across loads)
 *   3. per-environment default from the registry
 *
 * Production safety: overrides are gated on `allowOverrides` (dev, or an admin
 * in prod). A normal production player always gets the registry default — the
 * URL/localStorage channels are inert for them.
 */

import { ENV } from '../config/env';

export interface FlagDef {
  key: string;
  description: string;
  /** Who owns the decision to flip or remove this flag. */
  owner: string;
  /** Default state per environment. */
  defaults: { prod: boolean; dev: boolean };
  /** When this flag should be deleted (so the set stays lean). */
  removeWhen: string;
}

/**
 * The flag registry. Add a flag here with both environment defaults and a
 * removal condition; feature code reads it via `flag('<key>')`.
 */
export const FLAG_DEFS: readonly FlagDef[] = [
  {
    key: 'devTools',
    description:
      'Admin-only development test controls (grant coins, reset mastery/achievements, ' +
      'simulate Daily/Weekly dates, seed leaderboard). Never available to production players.',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'never — permanent development affordance, gated to non-prod + admin'
  },
  {
    key: 'delight',
    description:
      'V2 Phase 2 screen-entrance animations (landing/wizard/results fade-ins). ' +
      'Toggles the html.ff-delight class the CSS is scoped under.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'juice',
    description:
      'V2 Phase 6 shot juice: camera punch on strike, a made-putt cup burst, and ' +
      'bolder/longer on-fire ball trails. Does not affect the existing shot feel when off.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'layouts',
    description:
      'V2 content expansion: seeded alternate tee/pin layouts. Authored pin sets ' +
      'replace the random-ellipse pin; alternate tees join the seeded draw. ' +
      'Off = the original random pins + fixed tees, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'newCourses',
    description:
      'V2 content expansion: Red Hollow + Wild Prairie in the course roster, ' +
      'Play Next rotation, and wizard. Off = the original four-course roster.',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'flip prod:true to release (incl. WEEKLY_ROTATION growth), then remove'
  },
  {
    key: 'audio',
    description:
      'V2 Phase 5 audio identity: WebAudio SFX variation (impacts/putt/swing), ' +
      'surface-shaped landing thumps, per-course procedural ambient beds, and the ' +
      'results-screen UI tick. Off = the original HTMLAudio pipeline, byte-identical.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'personality',
    description:
      'V2 Phase 3 character personality: per-character idle tempo, aim waggle, ' +
      'celebration selection/amplitude, and dejection depth (data in ' +
      'characterPersonality.ts). Cosmetic only; off = the shared V1 behavior.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'atmosphere',
    description:
      'V2 Phase 4 ambient course life (drifting birds/gulls, ship bob, per-course ' +
      'motion tuning). Procedural, parked-RTT-safe.',
    owner: 'matt',
    defaults: { prod: true, dev: true },
    removeWhen: 'PROMOTED to prod (playtest pass 10) — remove the flag once it has soaked'
  },
  {
    key: 'boundedWorld',
    description:
      'Global dev rule: each hole is built and rendered as a tightly bounded ' +
      'playable world (~20 yd past the playable corridor). Beyond the boundary ' +
      'is off-course VOID — no terrain detail, vegetation, or rocks are ' +
      'generated, and a ball crossing it takes a one-stroke off-course penalty ' +
      'dropped back in the rough. Populates HoleData.boundary (derived per hole, ' +
      'or authored). Off = the classic full-world behavior, byte-identical.',
    owner: 'matt',
    defaults: { prod: false, dev: true },
    removeWhen: 'flip prod:true once the bounded-world pass is validated & approved, then remove'
  }
];

const DEFS_BY_KEY = new Map(FLAG_DEFS.map((d) => [d.key, d]));

/** Admins may override flags in any environment; dev may always override. */
let allowOverrides = !ENV.isProd;

/**
 * Grant flag-override power for this session (called once the signed-in user is
 * confirmed to be an admin). Lets an admin flip a flag on the live site without
 * exposing the channel to normal players.
 */
export function enableFlagOverrides(isAdmin: boolean): void {
  if (isAdmin) allowOverrides = true;
}

function readOverride(key: string): boolean | null {
  if (!allowOverrides) return null;
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get(`ff.${key}`);
      if (q === 'on') return true;
      if (q === 'off') return false;
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(`ff.${key}`);
      if (s === 'on') return true;
      if (s === 'off') return false;
    }
  } catch {
    /* storage/URL unavailable — fall through to the default */
  }
  return null;
}

/** Resolve a flag to its effective boolean for this environment + overrides. */
export function flag(key: string): boolean {
  const def = DEFS_BY_KEY.get(key);
  if (!def) {
    // An unknown key is a programming error; fail safe to OFF rather than throw
    // on a hot path.
    if (!ENV.isProd) console.warn(`[flags] unknown flag "${key}" — defaulting off`);
    return false;
  }
  const override = readOverride(key);
  if (override !== null) return override;
  return ENV.isProd ? def.defaults.prod : def.defaults.dev;
}

/** Persist a sticky override (admin dev tooling). Pass null to clear it. */
export function setFlagOverride(key: string, value: boolean | null): void {
  if (!allowOverrides || typeof localStorage === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(`ff.${key}`);
    else localStorage.setItem(`ff.${key}`, value ? 'on' : 'off');
  } catch {
    /* ignore — overrides are best-effort */
  }
}

/** Snapshot of every flag's effective value (for a dev/admin flags panel). */
export function allFlags(): Array<{ def: FlagDef; value: boolean }> {
  return FLAG_DEFS.map((def) => ({ def, value: flag(def.key) }));
}
