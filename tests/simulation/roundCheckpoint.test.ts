import { describe, expect, it } from 'vitest';
import {
  checkpointFor,
  clearCheckpoint,
  isResumable,
  loadCheckpoint,
  markResumeAttempt,
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

/**
 * RESUMING MID-HOLE.
 *
 * The checkpoint used to store only the hole boundary, so "finish the round"
 * re-teed the hole you were standing in the middle of. Defensible on paper and
 * infuriating in practice: three good shots into a par 5 and you are sent back
 * to the tee, which is a worse offer than starting a new round.
 */
describe('a half-played hole', () => {
  const base = {
    courseId: 'wildwood',
    seed: 7,
    holes: 3,
    parSoFar: 0,
    at: 1_000_000
  };

  it('is worth resuming even on the FIRST hole', () => {
    // The old rule was "some hole must be complete", which is exactly why an
    // exit on hole 1 lost everything.
    const cp = checkpointFor({ ...base, holeIdx: 0, scores: [], ball: { x: 400, y: 900 }, strokes: 2 });
    expect(isResumable(cp, base.at)).toBe(true);
    expect(cp.strokes).toBe(2);
    expect(cp.ball).toEqual({ x: 400, y: 900 });
  });

  it('is not recorded for a ball still on the tee', () => {
    // "Resume, on the tee, having played none" is just starting the hole.
    const cp = checkpointFor({ ...base, holeIdx: 0, scores: [], ball: { x: 400, y: 900 }, strokes: 0 });
    expect(cp.ball).toBeUndefined();
    expect(isResumable(cp, base.at)).toBe(false);
  });

  it('takes the position and the stroke count together or not at all', () => {
    // A position without a stroke count would resume the lie and lose the
    // score, which is a worse outcome than not resuming.
    expect(isResumable({ ...checkpointFor({ ...base, holeIdx: 1, scores: [4] }), ball: { x: 1, y: 2 } }, base.at)).toBe(
      false
    );
    expect(isResumable({ ...checkpointFor({ ...base, holeIdx: 1, scores: [4] }), strokes: 3 }, base.at)).toBe(false);
  });

  it('still resumes a checkpoint written before mid-hole existed', () => {
    // Those have no ball and no strokes, and must keep meaning exactly what
    // they always meant: start the in-progress hole from its tee.
    const old = checkpointFor({ ...base, holeIdx: 1, scores: [4] });
    expect(old.ball).toBeUndefined();
    expect(isResumable(old, base.at)).toBe(true);
  });
});

describe('the crash-loop breaker', () => {
  // Owner report, verbatim: "White screened on wild prairie hole 3 three
  // times in a row and can't resume with the resume button." A checkpoint
  // whose round keeps killing the tab must retire itself after two strikes —
  // losing one card beats a device trapped in a crash loop.
  it('two strikes retire the record; one leaves it offered', () => {
    const s = memStorage();
    saveCheckpoint(sample(), s);
    markResumeAttempt(s);
    expect(loadCheckpoint(NOW, s), 'one strike must still offer the resume').not.toBeNull();
    markResumeAttempt(s);
    expect(loadCheckpoint(NOW, s), 'two strikes must retire it').toBeNull();
  });

  it('a fresh checkpoint write resets the count (the round settled again)', () => {
    const s = memStorage();
    saveCheckpoint(sample(), s);
    markResumeAttempt(s);
    // The resumed round reached rest — checkpointRound writes a fresh record
    // (checkpointFor never sets `attempts`), and the slate is clean.
    saveCheckpoint(sample(), s);
    markResumeAttempt(s);
    expect(loadCheckpoint(NOW, s)).not.toBeNull();
  });

  it('striking with no record, or a corrupt one, is harmless', () => {
    const s = memStorage();
    markResumeAttempt(s); // nothing stored
    expect(loadCheckpoint(NOW, s)).toBeNull();
    s.setItem('bsg.roundCheckpoint.v1', '{corrupt');
    markResumeAttempt(s);
    expect(loadCheckpoint(NOW, s)).toBeNull();
  });
});
