/**
 * Development test-data controls (the devTools flag's consumer — see
 * docs/technical/DEVELOPMENT_ENVIRONMENT_AND_RELEASES.md §Development test
 * data). This module owns the ACTIVATION RULE and the simulated-date seam;
 * the panel UI lives with the profile screen in slice3d/main.ts.
 *
 * Hard gate: devToolsActive() requires BOTH the flag AND a non-production
 * environment — an admin flipping ?ff.devTools=on on the live site still
 * gets nothing, per the documented "never available to production players"
 * guarantee. Every consumer must go through devToolsActive().
 */

import { ENV } from '../config/env';
import { flag } from './flags';

/** The one activation rule: flag on AND not production. */
export function devToolsActive(): boolean {
  return !ENV.isProd && flag('devTools');
}

const DATE_KEY = 'dev.dateOverride';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The simulated date key (YYYY-MM-DD), or null when not simulating. */
export function devDateOverride(): string | null {
  if (!devToolsActive()) return null;
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(DATE_KEY) : null;
    return v && DATE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Set (or clear with null) the simulated date. No-op outside dev tools. */
export function setDevDateOverride(dateKey: string | null): void {
  if (!devToolsActive()) return;
  try {
    if (dateKey === null) localStorage.removeItem(DATE_KEY);
    else if (DATE_RE.test(dateKey)) localStorage.setItem(DATE_KEY, dateKey);
  } catch {
    /* storage unavailable — simulation simply stays off */
  }
}

/**
 * "Now" with the simulated date applied (local noon, so day-boundary math
 * in either direction stays on the simulated day). The Daily and Weekly
 * systems read time through this seam; real time everywhere else.
 */
export function devNow(): Date {
  const key = devDateOverride();
  return key ? new Date(`${key}T12:00:00`) : new Date();
}
