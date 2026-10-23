import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  consumeOAuthState,
  createOAuthState,
  deleteInstagramCredential,
  recordApproval,
  getInstagramCredential,
  openSecret,
  saveInstagramCredential,
  sealSecret,
  tables as t,
  type Db,
  type SealingKey,
} from '../src/index';
import { agent, episodeAwaitingApproval, freshDb, owner, signFor, studioKeys } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

const key: SealingKey = { keyId: 'k1', key: randomBytes(32) };
const TOKEN = 'IGQVJ-fake-token-for-tests-only';

describe('sealed secrets', () => {
  it('round-trips and rejects tampering or the wrong key', () => {
    const sealed = sealSecret(TOKEN, key);
    expect(sealed).not.toContain(TOKEN);
    expect(openSecret(sealed, key)).toBe(TOKEN);
    const parts = sealed.split('.');
    parts[4] = Buffer.from('x').toString('base64url');
    expect(() => openSecret(parts.join('.'), key)).toThrow(/failed authentication/);
    expect(() => openSecret(sealed, { keyId: 'k1', key: randomBytes(32) })).toThrow(/failed authentication/);
    expect(() => openSecret(sealed, { keyId: 'k2', key: key.key })).toThrow(/sealed with key k1/);
  });
});

describe('instagram credentials', () => {
  const input = { accountId: 'ig-main', igUserId: '1789', username: 'lifeupdated', accessToken: TOKEN, scopes: ['instagram_business_basic'], issuedAt: new Date('2026-10-22T00:00:00Z'), expiresAt: new Date('2026-12-21T00:00:00Z') };

  it('refuses to swap the Instagram user behind an account, and disconnecting revokes its approvals', async () => {
    await saveInstagramCredential(db, { ...input, key, actor: owner });
    await expect(saveInstagramCredential(db, { ...input, igUserId: '9999', key, actor: owner })).rejects.toThrow(/different Instagram account/);
    await saveInstagramCredential(db, { ...input, accessToken: `${TOKEN}-refreshed`, key, actor: owner });

    const keys = studioKeys();
    const { pkg } = await episodeAwaitingApproval(db);
    const approvalId = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });
    await deleteInstagramCredential(db, pkg.accountId, owner);
    const [row] = (await db.select().from(t.approvals)).filter((a) => a.id === approvalId);
    expect(row!.revokedAt).not.toBeNull();
    await saveInstagramCredential(db, { ...input, accountId: pkg.accountId, igUserId: '9999', key, actor: owner });
  });

  it('stores only ciphertext and never audits the token', async () => {
    await saveInstagramCredential(db, { ...input, key, actor: owner });
    const [row] = await db.select().from(t.instagramCredentials);
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    const audits = await db.select().from(t.auditEvents);
    expect(JSON.stringify(audits)).not.toContain(TOKEN);
    const cred = await getInstagramCredential(db, 'ig-main', key);
    expect(cred!.accessToken()).toBe(TOKEN);
  });

  it('only the owner can connect an account', async () => {
    await expect(saveInstagramCredential(db, { ...input, key, actor: agent })).rejects.toThrow(/only the owner/);
  });
});

describe('oauth state', () => {
  const T0 = new Date('2026-10-22T10:00:00Z');
  it('is single-use, purpose-bound and expires', async () => {
    const s = await createOAuthState(db, 'instagram_connect', T0);
    expect(await consumeOAuthState(db, s, 'other', T0)).toBe(false);
    expect(await consumeOAuthState(db, s, 'instagram_connect', T0)).toBe(true);
    expect(await consumeOAuthState(db, s, 'instagram_connect', T0)).toBe(false);
    const late = await createOAuthState(db, 'instagram_connect', T0);
    expect(await consumeOAuthState(db, late, 'instagram_connect', new Date(T0.getTime() + 11 * 60_000))).toBe(false);
    expect(await consumeOAuthState(db, "'; drop table x; --", 'instagram_connect', T0)).toBe(false);
  });
});
