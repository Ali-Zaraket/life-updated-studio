'use server';

import { deleteInstagramCredential, saveInstagramCredential, sealingKeyFromEnv } from '@life/db';
import { CONNECT_ASSUMPTIONS, verifyAccessToken } from '@life/instagram';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { done, fail, UserError } from '@/lib/flash';
import { accountId, assumedExpiry, safeMessage } from '@/lib/instagram-config';

const PATH = '/settings/instagram';

/** The token is read, verified, sealed and dropped. It never goes into a redirect, flash message or log. */
export async function pasteTokenAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  let token = String(fd.get('token') ?? '').trim();
  try {
    if (token.length < 20 || /\s/.test(token)) throw new UserError('That does not look like an access token.');
    const key = sealingKeyFromEnv(); // fails early with key_missing before any network call
    let identity;
    try {
      identity = await verifyAccessToken(fetch, token); // outbound call, owner-submitted only
    } catch (e) {
      throw new UserError(`Meta did not accept the token: ${safeMessage(e, token)}`);
    }
    const now = new Date();
    await saveInstagramCredential(await getDb(), {
      accountId: accountId(),
      igUserId: identity.igUserId,
      username: identity.username,
      accessToken: token,
      scopes: [...CONNECT_ASSUMPTIONS.scopes],
      issuedAt: now,
      expiresAt: assumedExpiry(now),
      key,
      actor: { kind: 'owner', ownerId },
      now,
    });
  } catch (e) {
    const safe = e instanceof UserError ? new UserError(safeMessage(e, token)) : e;
    token = '';
    fail(PATH, safe);
  }
  token = '';
  done(PATH, 'Instagram connected. Expiry is assumed to be 60 days; check it in Meta.');
}

export async function disconnectAction(): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    await deleteInstagramCredential(await getDb(), accountId(), { kind: 'owner', ownerId });
  } catch (e) {
    fail(PATH, e);
  }
  done(PATH, 'Instagram disconnected. The stored token was deleted.');
}
