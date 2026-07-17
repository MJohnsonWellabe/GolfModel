/**
 * Weekly Featured Round leaderboard persistence — plain REST against the RTDB
 * `/weekly/{eventId}/entries/{playerId}` node (the Tournaments.ts pattern:
 * fire-and-forget writes, bounded reads, friends-tier trust documented in
 * systems/WeeklyFeatured.ts). Rules (docs/FIREBASE_SETUP.md): world-readable,
 * write-once per player per event — a posted weekly score can't be
 * overwritten server-side, so the client submits ONLY the player's best
 * (checked against the local record before any network).
 */

import { LEADERBOARD_URL } from '../config';
import { isPlausibleWeeklyEntry, WeeklyEntry } from '../systems/WeeklyFeatured';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Submit a weekly entry (first write per player stands, server-side). Returns
 *  false when skipped (implausible, bad ids, offline). */
export async function submitWeeklyEntry(eventId: string, entry: WeeklyEntry): Promise<boolean> {
  if (!/^w\d{4}-\d{2}$/.test(eventId) || !SAFE_ID.test(entry.playerId)) return false;
  if (!isPlausibleWeeklyEntry(entry)) return false;
  try {
    const res = await fetch(
      `${LEADERBOARD_URL}/weekly/${eventId}/entries/${encodeURIComponent(entry.playerId)}.json`,
      { method: 'PUT', body: JSON.stringify(entry) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch an event's entries (6s abort; [] on absent/offline). */
export async function fetchWeeklyEntries(eventId: string): Promise<WeeklyEntry[]> {
  if (!/^w\d{4}-\d{2}$/.test(eventId)) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${LEADERBOARD_URL}/weekly/${eventId}/entries.json`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, WeeklyEntry> | null;
    return data ? Object.values(data).filter((e) => isPlausibleWeeklyEntry(e)) : [];
  } catch {
    return [];
  }
}
