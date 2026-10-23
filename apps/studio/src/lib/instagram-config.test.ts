import { describe, expect, it } from 'vitest';
import { accountId, assumedExpiry, instagramMode, oauthConfig, safeMessage } from './instagram-config';

describe('instagram config', () => {
  it('defaults to mock and instagram-main', () => {
    expect(instagramMode({})).toBe('mock');
    expect(instagramMode({ INSTAGRAM_MODE: 'live' })).toBe('live');
    expect(accountId({})).toBe('instagram-main');
    expect(accountId({ INSTAGRAM_ACCOUNT_ID: 'x' })).toBe('x');
  });
  it('requires all three settings and https', () => {
    const base = { INSTAGRAM_APP_ID: 'a', INSTAGRAM_APP_SECRET: 's', INSTAGRAM_REDIRECT_URI: 'https://x.test/auth/instagram/callback' };
    expect(oauthConfig(base)).not.toBeNull();
    expect(oauthConfig({ ...base, INSTAGRAM_REDIRECT_URI: 'http://localhost:3100/cb' })).toBeNull();
    expect(oauthConfig({ ...base, INSTAGRAM_APP_SECRET: '' })).toBeNull();
    expect(oauthConfig({ ...base, INSTAGRAM_REDIRECT_URI: 'not a url' })).toBeNull();
  });
  it('assumes 60 days', () => {
    expect(assumedExpiry(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
  it('redacts secrets from messages', () => {
    expect(safeMessage(new Error('bad token IGAAsecret123 here'), 'IGAAsecret123')).not.toContain('IGAAsecret123');
  });
});
