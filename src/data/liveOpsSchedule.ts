/**
 * Live Ops schedule preview (Studio Module 1 completion — Prompt 14).
 *
 * Pure builders that render a draft LiveOpsConfig into the EFFECTIVE
 * player-facing schedule: what daily challenge each of the next N days will
 * actually serve, and what course each upcoming Weekly Featured event will
 * actually run. Crucially these call the game's own deterministic resolvers
 * (dailyChallengeFor, weeklyEventFor) plus the same override maps the game
 * reads, so the preview can never drift from player reality (Studio
 * architecture: "preview the real player experience").
 *
 * Admin-only consumers (src/admin/liveOps.ts) — the game bundle never
 * imports this module.
 */

import { DAILY_CHALLENGES, dailyChallengeFor } from './progression';
import { LiveOpsConfig } from './liveOpsConfig';
import { weeklyEventFor } from '../systems/WeeklyFeatured';

export interface DailyPreviewEntry {
  /** YYYY-MM-DD */
  date: string;
  challengeId: string;
  challengeName: string;
  /** Whether an override pinned this day or the deterministic hash chose it. */
  source: 'override' | 'default';
  /** An override that picks what the hash would pick anyway (safe to remove). */
  redundant: boolean;
}

export interface WeeklyPreviewEntry {
  /** wYYYY-WW */
  weekId: string;
  courseId: string;
  source: 'override' | 'default';
  redundant: boolean;
}

const DAY_MS = 86_400_000;

/** Parse YYYY-MM-DD at UTC noon (immune to DST edges when stepping days). */
function parseKey(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

function fmtKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The effective daily-challenge schedule for `days` days from `startKey`. */
export function previewDailySchedule(cfg: LiveOpsConfig, startKey: string, days: number): DailyPreviewEntry[] {
  const start = parseKey(startKey);
  const byId = new Map(DAILY_CHALLENGES.map((c) => [c.id, c]));
  const out: DailyPreviewEntry[] = [];
  for (let i = 0; i < days; i++) {
    const date = fmtKey(new Date(start.getTime() + i * DAY_MS));
    const fallback = dailyChallengeFor(date);
    const overrideId = cfg.dailyOverrides?.[date];
    const override = overrideId ? byId.get(overrideId) : undefined;
    const eff = override ?? fallback;
    out.push({
      date,
      challengeId: eff.id,
      challengeName: eff.name,
      source: override ? 'override' : 'default',
      redundant: !!override && override.id === fallback.id
    });
  }
  return out;
}

/** The effective Weekly Featured schedule for the next `weeks` events,
 *  starting from the week containing `from`. */
export function previewWeeklySchedule(cfg: LiveOpsConfig, from: Date, weeks: number): WeeklyPreviewEntry[] {
  const out: WeeklyPreviewEntry[] = [];
  const seen = new Set<string>();
  // Step in 7-day hops; dedupe by event id so a DST-shifted boundary can
  // never double-count or skip a week in the preview.
  for (let i = 0; out.length < weeks && i < weeks + 2; i++) {
    const ev = weeklyEventFor(new Date(from.getTime() + i * 7 * DAY_MS));
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const overrideCourse = cfg.weeklyOverrides?.[ev.id];
    out.push({
      weekId: ev.id,
      courseId: overrideCourse ?? ev.courseId,
      source: overrideCourse ? 'override' : 'default',
      redundant: !!overrideCourse && overrideCourse === ev.courseId
    });
  }
  return out;
}

/**
 * Conflict detection (non-blocking, distinct from validation errors):
 * overrides that are redundant no-ops — they pin exactly what the
 * deterministic default would serve anyway, which usually means the admin
 * meant a different date/course. Past-dated entries are covered separately
 * by warnLiveOpsConfig.
 */
export function detectRedundantOverrides(cfg: LiveOpsConfig, horizonDays = 60): string[] {
  const notices: string[] = [];
  for (const [date, id] of Object.entries(cfg.dailyOverrides ?? {})) {
    if (dailyChallengeFor(date).id === id) {
      notices.push(`Daily override ${date} pins "${id}", which that day already serves by default.`);
    }
  }
  // Weekly ids encode their week; compare against the rotation via preview.
  const weekly = previewWeeklySchedule(cfg, new Date(), Math.ceil(horizonDays / 7));
  for (const w of weekly) {
    if (w.redundant) {
      notices.push(`Weekly override ${w.weekId} pins "${w.courseId}", which that week already runs by default.`);
    }
  }
  return notices;
}
