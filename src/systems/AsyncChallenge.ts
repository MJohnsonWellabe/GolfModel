/**
 * Asynchronous challenges (retention plan, Part 9) — "beat my score on this
 * exact setup" without simultaneous play. A challenge is a small, versioned,
 * self-contained payload encoded as a base64url string, carried in a share
 * URL's `?c=` query parameter (GitHub Pages serves only static files, so the
 * code travels IN the URL — no server route, no database requirement; the
 * recipient's client decodes everything locally).
 *
 * Standardization: the challenge carries the SAME shared-seed mechanism
 * tournaments use, so both players face identical wind and pins.
 *
 * Score-validation honesty (documented limitation): the payload — like the
 * public tournament leaderboard — is client-authored. There is no
 * server-authoritative validation; a determined cheater can fabricate a
 * target. This matches the existing friends-tier trust model
 * (src/firebase/Tournaments.ts) and is acceptable for friendly challenges.
 *
 * No user-generated free text beyond a display name, which is length-capped
 * and sanitized to a conservative character set before encoding AND after
 * decoding (defense in depth — the decoder never trusts the encoder).
 */

export interface AsyncChallengeDef {
  v: 1;
  courseId: string;
  mode: string;
  /** Shared RNG seed → identical wind/pins for both players. */
  seed: number;
  /** The score to beat. */
  total: number;
  toPar: number;
  /** Creator display identity (sanitized, max 20 chars). */
  creator: string;
  /** Epoch ms created. */
  at: number;
  /** Optional expiry (epoch ms); 0 = never. */
  exp: number;
}

const NAME_MAX = 20;

/** Conservative display-name sanitizer: letters/digits/space/basic punctuation. */
export function sanitizeName(name: string): string {
  return String(name ?? '')
    .replace(/[^\p{L}\p{N} .,'&-]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
}

function b64urlEncode(s: string): string {
  const b64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(s)))
    : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return typeof atob === 'function'
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Encode a challenge to a compact, URL-safe code. */
export function encodeChallenge(def: AsyncChallengeDef): string {
  // Compact positional payload (versioned) — much shorter than raw JSON keys.
  const payload = [1, def.courseId, def.mode, def.seed, def.total, def.toPar, sanitizeName(def.creator), def.at, def.exp];
  return b64urlEncode(JSON.stringify(payload));
}

/** Decode + validate a challenge code. Null on anything malformed. */
export function decodeChallenge(code: string): AsyncChallengeDef | null {
  if (!code || code.length > 400) return null;
  const raw = b64urlDecode(code.trim());
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr) || arr[0] !== 1) return null;
    const [, courseId, mode, seed, total, toPar, creator, at, exp] = arr;
    if (typeof courseId !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(courseId)) return null;
    if (typeof mode !== 'string' || !/^[a-z0-9_-]{1,16}$/.test(mode)) return null;
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
    if (typeof total !== 'number' || total < 3 || total > 60) return null;
    if (typeof toPar !== 'number' || Math.abs(toPar) > 30) return null;
    if (typeof at !== 'number' || at < 0) return null;
    if (typeof exp !== 'number' || exp < 0) return null;
    return {
      v: 1,
      courseId,
      mode,
      seed: seed >>> 0,
      total: Math.round(total),
      toPar: Math.round(toPar),
      creator: sanitizeName(typeof creator === 'string' ? creator : ''),
      at,
      exp
    };
  } catch {
    return null;
  }
}

/** True when the challenge has an expiry and it has passed. */
export function isExpired(def: AsyncChallengeDef, nowMs: number): boolean {
  return def.exp > 0 && nowMs > def.exp;
}

/** Share URL compatible with GitHub Pages routing (query param on the app root). */
export function challengeUrl(def: AsyncChallengeDef, baseUrl: string): string {
  const base = baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return `${base}/?c=${encodeChallenge(def)}`;
}

/** Extract a challenge code from a URL or raw code string. */
export function parseChallengeParam(urlOrCode: string): string | null {
  const s = String(urlOrCode ?? '').trim();
  if (!s) return null;
  const m = s.match(/[?&]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{8,400}$/.test(s) ? s : null;
}

/** Compare a finished round against the challenge. */
export function challengeOutcome(def: AsyncChallengeDef, total: number): 'beat' | 'tied' | 'lost' {
  if (total < def.total) return 'beat';
  if (total === def.total) return 'tied';
  return 'lost';
}
