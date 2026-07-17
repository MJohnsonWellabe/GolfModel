import { describe, expect, it } from 'vitest';
import {
  AsyncChallengeDef,
  challengeOutcome,
  challengeUrl,
  decodeChallenge,
  encodeChallenge,
  isExpired,
  parseChallengeParam,
  sanitizeName
} from '../src/systems/AsyncChallenge';
import { ChallengeDoc, outcomeFor } from '../src/firebase/Challenges';

function def(over: Partial<AsyncChallengeDef> = {}): AsyncChallengeDef {
  return {
    v: 1,
    courseId: 'sablebay',
    mode: 'solo',
    seed: 12345,
    total: 11,
    toPar: -1,
    creator: 'Matt',
    at: 1750000000000,
    exp: 0,
    cid: '',
    ...over
  };
}

describe('async challenge codes', () => {
  it('round-trips through encode/decode', () => {
    const d = def();
    expect(decodeChallenge(encodeChallenge(d))).toEqual(d);
  });

  it('the share URL is GitHub Pages compatible (query param, no route)', () => {
    const url = challengeUrl(def(), 'https://example.github.io/golf/');
    expect(url).toMatch(/^https:\/\/example\.github\.io\/golf\/\?c=[A-Za-z0-9_-]+$/);
    expect(parseChallengeParam(url)).toBe(url.split('?c=')[1]);
  });

  it('parseChallengeParam accepts a bare code too, rejects junk', () => {
    const code = encodeChallenge(def());
    expect(parseChallengeParam(code)).toBe(code);
    expect(parseChallengeParam('!!!not a code!!!')).toBeNull();
    expect(parseChallengeParam('')).toBeNull();
  });

  it('rejects malformed / hostile payloads', () => {
    expect(decodeChallenge('zzzz')).toBeNull();
    expect(decodeChallenge('a'.repeat(500))).toBeNull();
    // Valid base64url of the wrong structure:
    expect(decodeChallenge(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull();
    // Absurd totals:
    expect(decodeChallenge(encodeChallenge(def({ total: 999 })))).toBeNull();
  });

  it('sanitizes creator names on both encode and decode (no user-generated markup)', () => {
    const hostile = def({ creator: '<script>alert(1)</script> Bob!!' });
    const decoded = decodeChallenge(encodeChallenge(hostile))!;
    expect(decoded.creator).not.toContain('<');
    expect(decoded.creator).not.toContain('>');
    expect(sanitizeName("Ann-Marie O'Neil")).toBe("Ann-Marie O'Neil");
    expect(sanitizeName('x'.repeat(50)).length).toBe(20);
  });

  it('expiry and outcome helpers', () => {
    expect(isExpired(def({ exp: 100 }), 200)).toBe(true);
    expect(isExpired(def({ exp: 0 }), Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(challengeOutcome(def({ total: 11 }), 10)).toBe('beat');
    expect(challengeOutcome(def({ total: 11 }), 11)).toBe('tied');
    expect(challengeOutcome(def({ total: 11 }), 12)).toBe('lost');
  });
});

describe('1v1 result-tracking cid', () => {
  it('round-trips a cid through the code', () => {
    const d = def({ cid: 'ch1234abcd' });
    expect(decodeChallenge(encodeChallenge(d))!.cid).toBe('ch1234abcd');
  });

  it('a pre-1v1 link (no cid element) decodes with an empty cid', () => {
    const legacy = Buffer.from(
      JSON.stringify([1, 'sablebay', 'solo', 42, 11, -1, 'Matt', 1750000000000, 0])
    ).toString('base64url');
    const d = decodeChallenge(legacy)!;
    expect(d.courseId).toBe('sablebay');
    expect(d.cid).toBe('');
  });

  it('a hostile cid is dropped, not propagated', () => {
    const bad = Buffer.from(
      JSON.stringify([1, 'sablebay', 'solo', 42, 11, -1, 'Matt', 1750000000000, 0, '../evil path'])
    ).toString('base64url');
    expect(decodeChallenge(bad)!.cid).toBe('');
  });
});

describe('challenge outcome resolution (Challenges.outcomeFor)', () => {
  const doc = (over: Partial<ChallengeDoc> = {}): ChallengeDoc => ({
    cid: 'chabc123',
    courseId: 'sablebay',
    seed: 42,
    createdAt: 1,
    creator: { playerId: 'p-creator', name: 'Matt', total: 11, toPar: -1, at: 1 },
    ...over
  });

  it('creator is pending until someone responds', () => {
    expect(outcomeFor(doc(), 'p-creator')).toBe('pending');
  });

  it('creator wins when no response beats the target; loses when one does', () => {
    const beaten = doc({ responses: { 'p-r': { playerId: 'p-r', name: 'A', total: 10, toPar: -2, at: 2 } } });
    expect(outcomeFor(beaten, 'p-creator')).toBe('lost');
    expect(outcomeFor(beaten, 'p-r')).toBe('won');
    const held = doc({ responses: { 'p-r': { playerId: 'p-r', name: 'A', total: 12, toPar: 0, at: 2 } } });
    expect(outcomeFor(held, 'p-creator')).toBe('won');
    expect(outcomeFor(held, 'p-r')).toBe('lost');
  });

  it('equal totals tie for both sides', () => {
    const tied = doc({ responses: { 'p-r': { playerId: 'p-r', name: 'A', total: 11, toPar: -1, at: 2 } } });
    expect(outcomeFor(tied, 'p-creator')).toBe('tied');
    expect(outcomeFor(tied, 'p-r')).toBe('tied');
  });

  it('a bystander with no response is pending', () => {
    expect(outcomeFor(doc(), 'p-nobody')).toBe('pending');
  });
});
