/**
 * Live-Ops retention configuration: schema + pure validation + resolution.
 *
 * The retention systems are DETERMINISTIC BY DEFAULT (daily challenge hashed
 * from the date, weekly featured rotated from the ISO week) so the game never
 * depends on a server. This config is a thin OVERRIDE layer for routine live
 * operations — pin a specific daily challenge to a date, point a weekly event
 * at a different course — published to the public `/liveOpsConfig` node
 * (world-read, admin-write; mirrors /marketingConfig). Drafts stage privately
 * under /adminDrafts/retentionLiveOps until published.
 *
 * Explicit code-defined boundary (kept for integrity):
 *  - streak reward AMOUNTS, mastery third-star CONDITIONS, achievement
 *    DEFINITIONS and all reward math stay code-defined — they are gameplay
 *    economy and correctness surfaces, and a bad config must never be able to
 *    inflate rewards or brick a challenge. The admin page VIEWS them read-only.
 */

import { DAILY_CHALLENGES } from './progression';
import { WEEKLY_ROTATION } from '../systems/WeeklyFeatured';

export interface LiveOpsConfig {
  version: number;
  publishedAt: number;
  /** Email of the admin who published this version (audit trail, Phase 7). */
  publishedBy?: string;
  /** date key (YYYY-MM-DD) → daily challenge id (from DAILY_CHALLENGES). */
  dailyOverrides: Record<string, string>;
  /** weekly event id (e.g. 'w2026-29') → course id override. */
  weeklyOverrides: Record<string, string>;
}

/** One published-config audit record (append-only /adminAudit/liveOps). */
export interface LiveOpsAuditEntry {
  at: number;
  by: string;
  version: number;
  dailyCount: number;
  weeklyCount: number;
  /** 'publish' for a normal publish, 'revert' when rolling back. */
  action: 'publish' | 'revert';
}

export function emptyLiveOpsConfig(): LiveOpsConfig {
  return { version: 0, publishedAt: 0, dailyOverrides: {}, weeklyOverrides: {} };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_KEY = /^w\d{4}-\d{2}$/;

/** Coerce any fetched shape into a safe config (RTDB omits empty maps). */
export function migrateLiveOpsConfig(raw: unknown): LiveOpsConfig {
  const base = emptyLiveOpsConfig();
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Partial<LiveOpsConfig>;
  base.version = typeof c.version === 'number' ? c.version : 0;
  base.publishedAt = typeof c.publishedAt === 'number' ? c.publishedAt : 0;
  if (typeof c.publishedBy === 'string' && c.publishedBy) base.publishedBy = c.publishedBy;
  for (const [k, v] of Object.entries(c.dailyOverrides ?? {})) {
    if (DATE_KEY.test(k) && typeof v === 'string') base.dailyOverrides[k] = v;
  }
  for (const [k, v] of Object.entries(c.weeklyOverrides ?? {})) {
    if (WEEK_KEY.test(k) && typeof v === 'string') base.weeklyOverrides[k] = v;
  }
  return base;
}

/** Validation errors that must block a publish (unknown ids would brick the
 *  daily card / weekly event for every player on that date). */
export function validateLiveOpsConfig(cfg: LiveOpsConfig): string[] {
  const errors: string[] = [];
  const challengeIds = new Set(DAILY_CHALLENGES.map((c) => c.id));
  for (const [date, id] of Object.entries(cfg.dailyOverrides ?? {})) {
    if (!DATE_KEY.test(date)) errors.push(`Daily override "${date}": not a YYYY-MM-DD date key.`);
    if (!challengeIds.has(id)) errors.push(`Daily override ${date}: unknown challenge id "${id}".`);
  }
  const courses = new Set<string>(WEEKLY_ROTATION);
  for (const [week, courseId] of Object.entries(cfg.weeklyOverrides ?? {})) {
    if (!WEEK_KEY.test(week)) errors.push(`Weekly override "${week}": not a wYYYY-WW event id.`);
    if (!courses.has(courseId)) errors.push(`Weekly override ${week}: unknown course id "${courseId}".`);
  }
  return errors;
}

/**
 * Non-blocking notices (Phase 7): things worth flagging to the admin that do
 * NOT block a publish — chiefly overrides pinned to a date/week already in the
 * past, which are inert (the day/week has passed) and usually a typo. `todayKey`
 * is YYYY-MM-DD; `thisWeekId` is the current wYYYY-WW id.
 */
export function warnLiveOpsConfig(cfg: LiveOpsConfig, todayKey: string, thisWeekId: string): string[] {
  const warnings: string[] = [];
  for (const date of Object.keys(cfg.dailyOverrides ?? {})) {
    if (DATE_KEY.test(date) && date < todayKey) {
      warnings.push(`Daily override ${date} is in the past — it will never take effect.`);
    }
  }
  for (const week of Object.keys(cfg.weeklyOverrides ?? {})) {
    if (WEEK_KEY.test(week) && week < thisWeekId) {
      warnings.push(`Weekly override ${week} is in the past — it will never take effect.`);
    }
  }
  return warnings;
}

/** The effective daily challenge id for a date: override, else null (caller
 *  falls back to the deterministic dailyChallengeFor hash). */
export function dailyOverrideFor(cfg: LiveOpsConfig | null | undefined, dateKey: string): string | null {
  const id = cfg?.dailyOverrides?.[dateKey];
  return typeof id === 'string' && DAILY_CHALLENGES.some((c) => c.id === id) ? id : null;
}

/** The effective weekly course for an event id: override, else null (caller
 *  keeps the deterministic rotation). */
export function weeklyOverrideFor(cfg: LiveOpsConfig | null | undefined, eventId: string): string | null {
  const id = cfg?.weeklyOverrides?.[eventId];
  return typeof id === 'string' && (WEEKLY_ROTATION as readonly string[]).includes(id) ? id : null;
}
