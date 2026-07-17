import { describe, expect, it } from 'vitest';
import { resolveEnv, resolveEnvName, PROD_HOSTNAMES, MetaEnvLike } from '../src/config/env';

const NO_DEV: MetaEnvLike = {};
const DEV_PROJECT: MetaEnvLike = {
  VITE_DEV_FIREBASE_API_KEY: 'dev-key',
  VITE_DEV_FIREBASE_AUTH_DOMAIN: 'golf-dev.firebaseapp.com',
  VITE_DEV_FIREBASE_PROJECT_ID: 'golf-dev',
  VITE_DEV_FIREBASE_APP_ID: '1:dev:web:abc',
  VITE_DEV_FIREBASE_DB_URL: 'https://golf-dev-default-rtdb.firebaseio.com'
};

describe('environment resolution', () => {
  it('every production hostname resolves to prod', () => {
    for (const h of PROD_HOSTNAMES) expect(resolveEnvName(h, '')).toBe('prod');
  });

  it('localhost / preview / unknown hosts resolve to dev', () => {
    expect(resolveEnvName('localhost', '')).toBe('dev');
    expect(resolveEnvName('127.0.0.1', '')).toBe('dev');
    expect(resolveEnvName('deploy-preview-3.example.dev', '')).toBe('dev');
    expect(resolveEnvName('', '')).toBe('dev'); // node/test context
  });

  it('the ?env override wins over the hostname (both directions)', () => {
    expect(resolveEnvName('bsgolf.fun', '?env=dev')).toBe('dev');
    expect(resolveEnvName('localhost', '?env=prod')).toBe('prod');
    expect(resolveEnvName('bsgolf.fun', '?env=bogus')).toBe('prod'); // ignored
  });
});

describe('production config is the live literals (unchanged behavior)', () => {
  const prod = resolveEnv('bsgolf.fun', '', NO_DEV);
  it('points at golfgame-9c11e and its RTDB', () => {
    expect(prod.isProd).toBe(true);
    expect(prod.firebase.projectId).toBe('golfgame-9c11e');
    expect(prod.firebase.apiKey.length).toBeGreaterThan(0);
    expect(prod.leaderboardUrl).toBe('https://golfgame-9c11e-default-rtdb.firebaseio.com');
    expect(prod.firebase.databaseURL).toBe(prod.leaderboardUrl);
    expect(prod.analyticsNamespace).toBe('events');
  });
});

describe('development data isolation', () => {
  it('with no dev project configured, dev is local-only (dormant cloud)', () => {
    const dev = resolveEnv('localhost', '', NO_DEV);
    expect(dev.isProd).toBe(false);
    expect(dev.firebase.apiKey).toBe(''); // authConfigured() → false → cloud dormant
    expect(dev.leaderboardUrl).toBe(''); // REST transports → no-op
    expect(dev.analyticsNamespace).toBe('dev_events');
  });

  it('a fully configured dev project is used wholesale (separate from prod)', () => {
    const dev = resolveEnv('localhost', '', DEV_PROJECT);
    expect(dev.firebase.projectId).toBe('golf-dev');
    expect(dev.firebase.projectId).not.toBe('golfgame-9c11e');
    expect(dev.leaderboardUrl).toBe('https://golf-dev-default-rtdb.firebaseio.com');
  });

  it('a PARTIALLY configured dev project fails loudly (misconfiguration)', () => {
    const partial: MetaEnvLike = { VITE_DEV_FIREBASE_API_KEY: 'dev-key' };
    expect(() => resolveEnv('localhost', '', partial)).toThrow(/incomplete/i);
  });

  it('an override to dev on a prod host never borrows prod Firebase', () => {
    const dev = resolveEnv('bsgolf.fun', '?env=dev', NO_DEV);
    expect(dev.firebase.projectId).toBe(''); // NOT golfgame-9c11e
    expect(dev.leaderboardUrl).toBe('');
  });
});
