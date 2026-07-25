import { describe, expect, it } from 'vitest';
import { makeRivalInviteCode, pairId } from '../src/firebase/Rivals';

/**
 * The rivalry channel's addressing.
 *
 * Both sides must independently compute the SAME node name without talking to
 * each other first — that is the whole reason the id is derived rather than
 * assigned. If the derivation were order-dependent, each player would post to a
 * node the other never reads and every fixture would silently sit unsettled.
 */
describe('rival pair id', () => {
  it('is the same from either side', () => {
    expect(pairId('alice', 'bob')).toBe(pairId('bob', 'alice'));
  });

  it('is different for different pairs', () => {
    expect(pairId('alice', 'bob')).not.toBe(pairId('alice', 'carol'));
    expect(pairId('alice', 'bob')).not.toBe(pairId('dave', 'bob'));
  });

  it('is a safe database path segment', () => {
    // It goes straight into a URL path; anything outside this set would either
    // break the write or reach a node nobody meant to touch.
    for (const [a, b] of [
      ['alice', 'bob'],
      ['g-9f3c1e2a-0000-4444-8888-abcdefabcdef', 'uid_ABC-123'],
      ['z', 'a']
    ]) {
      expect(pairId(a, b)).toMatch(/^[A-Za-z0-9_-]{6,40}$/);
    }
  });

  it('does not spell out either player id', () => {
    // The node name is world-readable; it should not hand out identities.
    const id = pairId('alice', 'bob');
    expect(id).not.toContain('alice');
    expect(id).not.toContain('bob');
  });
});

describe('rival invite code', () => {
  it('is a safe path segment and not repeated', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const c = makeRivalInviteCode();
      expect(c).toMatch(/^[A-Za-z0-9_-]{6,32}$/);
      codes.add(c);
    }
    expect(codes.size).toBe(50);
  });
});
