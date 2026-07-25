import { describe, expect, it } from 'vitest';
import {
  checkpointFor,
  clearCheckpoint,
  isResumable,
  loadCheckpoint,
  MAX_AGE_MS,
  RoundCheckpoint,
  saveCheckpoint,
  toParLabel
} from '../../src/systems/RoundCheckpoint';

/**
 * Guards the unfinished-round checkpoint (`resumeRound`). The rule this file
 * exists to enforce: a checkpoint is offered ONLY when resuming it can produce
 * a coherent round. Anything else — stale, structurally broken, or with no
 * progress worth returning for — must read back as "no checkpoint" rather than
 * as a Resume button that produces a wrong scorecard.
 */

function memStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  };
}

const NOW = 1_700_000_000_000;

function sample(over: Partial<RoundCheckpoint> = {}): RoundCheckpoint {
  return {
    ...checkpointFor({
      courseId: 'sablebay',
      seed: 42,
      holeIdx: 1,
      holes: 3,
      scores: [4],
      parSoFar: 4,
      at: NOW
    }),
    ...over
  };
}

describe('round checkpoint', () => {
  it('round-trips a mid-round checkpoint through storage', () => {
    const s = memStorage();
    const cp = sample();
    saveCheckpoint(cp, s);
    expect(loadCheckpoint(NOW, s)).toEqual(cp);
  });

  it('keeps only the scores for holes actually completed', () => {
    // The live round carries a full-length score array; the checkpoint must not
    // record strokes for the hole that was still in progress.
    const cp = checkpointFor({
      courseId: 'sablebay',
      seed: 1,
      holeIdx: 2,
      holes: 3,
      scores: [4, 5, 3],
      parSoFar: 8,
      at: NOW
    });
    expect(cp.scores).toEqual([4, 5]);
  });

  it('does not offer a resume when nothing has been played yet', () => {
    // Hole 1 with an empty card is just "Play" under another name.
    expect(isResumable(sample({ holeIdx: 0, scores: [] }), NOW)).toBe(false);
  });

  it('expires a checkpoint older than the cutoff', () => {
    expect(isResumable(sample(), NOW + MAX_AGE_MS - 1)).toBe(true);
    expect(isResumable(sample(), NOW + MAX_AGE_MS + 1)).toBe(false);
  });

  it('rejects records whose scores do not line up with the hole reached', () => {
    // A mismatch here would put the wrong strokes on the resumed scorecard.
    expect(isResumable(sample({ holeIdx: 2, scores: [4] }), NOW)).toBe(false);
    expect(isResumable(sample({ holeIdx: 1, scores: [4, 5] }), NOW)).toBe(false);
  });

  it('rejects a hole index outside the round', () => {
    expect(isResumable(sample({ holeIdx: 3, scores: [4, 4, 4] }), NOW)).toBe(false);
  });

  it('rejects a version it does not understand', () => {
    expect(isResumable(sample({ v: 99 }), NOW)).toBe(false);
  });

  it('rejects malformed numbers rather than resuming a broken round', () => {
    expect(isResumable(sample({ seed: NaN }), NOW)).toBe(false);
    expect(isResumable(sample({ scores: [NaN] }), NOW)).toBe(false);
    expect(isResumable(sample({ courseId: '' }), NOW)).toBe(false);
  });

  it('reads corrupt stored JSON as no checkpoint', () => {
    const s = memStorage();
    s.setItem('bsg.roundCheckpoint.v1', '{not json');
    expect(loadCheckpoint(NOW, s)).toBeNull();
  });

  it('clears', () => {
    const s = memStorage();
    saveCheckpoint(sample(), s);
    clearCheckpoint(s);
    expect(loadCheckpoint(NOW, s)).toBeNull();
  });

  it('labels the score so far the way a scorecard would', () => {
    expect(toParLabel(sample({ scores: [4], parSoFar: 4 }))).toBe('E');
    expect(toParLabel(sample({ scores: [6], parSoFar: 4 }))).toBe('+2');
    expect(toParLabel(sample({ scores: [3], parSoFar: 4 }))).toBe('-1');
  });
});
