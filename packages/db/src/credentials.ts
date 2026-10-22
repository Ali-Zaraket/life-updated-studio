import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Actor } from '@life/contracts';
import type { Db } from './client';
import { DomainError, audit } from './repo';
import * as t from './schema';

/**
 * Secrets at rest: AES-256-GCM, `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url).
 * The 32-byte key comes from local env (INSTAGRAM_TOKEN_KEY, base64) and never touches the database.
 */
export interface SealingKey {
  keyId: string;
  key: Buffer;
}

export function sealingKeyFromEnv(env: NodeJS.ProcessEnv = process.env): SealingKey {
  const raw = env.INSTAGRAM_TOKEN_KEY;
  if (!raw) throw new DomainError('key_missing', 'INSTAGRAM_TOKEN_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new DomainError('key_invalid', 'INSTAGRAM_TOKEN_KEY must be 32 bytes, base64');
  return { keyId: env.INSTAGRAM_TOKEN_KEY_ID ?? 'local-1', key };
}

export function sealSecret(plaintext: string, k: SealingKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.key, iv);
  cipher.setAAD(Buffer.from(k.keyId));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const b = (x: Buffer) => x.toString('base64url');
  return ['v1', k.keyId, b(iv), b(cipher.getAuthTag()), b(ct)].join('.');
}

export function openSecret(sealed: string, k: SealingKey): string {
  const [v, keyId, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !keyId || !iv || !tag || ct === undefined) throw new DomainError('sealed_invalid', 'malformed sealed secret');
  if (keyId !== k.keyId) throw new DomainError('key_mismatch', `secret sealed with key ${keyId}`);
  const decipher = createDecipheriv('aes-256-gcm', k.key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(keyId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new DomainError('sealed_tampered', 'sealed secret failed authentication');
  }
}

export interface InstagramCredentialInput {
  accountId: string;
  igUserId: string;
  username: string | null;
  accessToken: string;
  scopes: string[];
  issuedAt: Date;
  expiresAt: Date;
}

/** Only the owner (through the studio) connects or replaces the Instagram account. */
export async function saveInstagramCredential(db: Db, input: InstagramCredentialInput & { key: SealingKey; actor: Actor; now?: Date }): Promise<void> {
  if (input.actor.kind !== 'owner' && !(input.actor.kind === 'system' && input.actor.component === 'token-refresh')) {
    throw new DomainError('owner_only', 'only the owner can connect an Instagram account');
  }
  const now = input.now ?? new Date();
  const row = {
    accountId: input.accountId,
    igUserId: input.igUserId,
    username: input.username,
    tokenSealed: sealSecret(input.accessToken, input.key),
    keyId: input.key.keyId,
    scopes: input.scopes,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(t.instagramCredentials).values(row).onConflictDoUpdate({ target: t.instagramCredentials.accountId, set: row });
    // Never the token: only what changed.
    await audit(tx, { actor: input.actor, action: 'instagram.credential_saved', entityType: 'instagram_account', entityId: input.accountId, details: { igUserId: input.igUserId, scopes: input.scopes, expiresAt: row.expiresAt }, now });
  });
}

export interface InstagramCredential {
  accountId: string;
  igUserId: string;
  username: string | null;
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  /** Decrypts on demand so the plaintext is not held longer than a request. */
  accessToken: () => string;
}

export async function getInstagramCredential(db: Db, accountId: string, key: SealingKey): Promise<InstagramCredential | null> {
  const [row] = await db.select().from(t.instagramCredentials).where(eq(t.instagramCredentials.accountId, accountId));
  if (!row) return null;
  return {
    accountId: row.accountId,
    igUserId: row.igUserId,
    username: row.username,
    scopes: row.scopes as string[],
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    accessToken: () => openSecret(row.tokenSealed, key),
  };
}

export async function deleteInstagramCredential(db: Db, accountId: string, actor: Actor): Promise<void> {
  if (actor.kind !== 'owner') throw new DomainError('owner_only', 'only the owner can disconnect Instagram');
  await db.transaction(async (tx) => {
    await tx.delete(t.instagramCredentials).where(eq(t.instagramCredentials.accountId, accountId));
    await audit(tx, { actor, action: 'instagram.disconnected', entityType: 'instagram_account', entityId: accountId });
  });
}

// ---------------------------------------------------------------- OAuth state

export async function createOAuthState(db: Db, purpose: string, now = new Date(), ttlMs = 10 * 60_000): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  await db.insert(t.oauthStates).values({ state, purpose, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() });
  return state;
}

/** Single use: succeeds once for an unexpired state of the right purpose. */
export async function consumeOAuthState(db: Db, state: string, purpose: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  const rows = await db
    .update(t.oauthStates)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(t.oauthStates.state, state), eq(t.oauthStates.purpose, purpose), isNull(t.oauthStates.usedAt), gt(t.oauthStates.expiresAt, now.toISOString())))
    .returning({ state: t.oauthStates.state });
  return rows.length === 1 && timingSafeEqual(Buffer.from(rows[0]!.state), Buffer.from(state));
}
