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
