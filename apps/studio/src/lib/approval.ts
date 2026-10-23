// SERVER ONLY. Holds the approval private key. Import solely from server actions / server modules,
// never from client components. The key, the signature and the PEM are never logged or rendered.
import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildApprovalPayload,
  signApproval,
  type ReleasePackage,
} from '@life/contracts';
import { recordApproval, type Db } from '@life/db';
import { requiredEnv, resolveFromRoot } from './env';

if (typeof window !== 'undefined') throw new Error('approval.ts must never be bundled for the client');

function loadKey(): { keyId: string; privateKey: KeyObject; publicKey: KeyObject } {
  const keyId = requiredEnv('STUDIO_APPROVAL_KEY_ID');
  const path = resolveFromRoot(requiredEnv('STUDIO_APPROVAL_PRIVATE_KEY_PATH'));
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(readFileSync(path, 'utf8'));
  } catch {
    // Deliberately vague: never echo key material or paths from parser errors.
    throw new Error('approval key could not be loaded; run the approval-key script and check STUDIO_APPROVAL_PRIVATE_KEY_PATH');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('approval key must be Ed25519');
  return { keyId, privateKey, publicKey: createPublicKey(privateKey) };
}

export interface ApprovalChoice {
  notBefore: Date;
  notAfter: Date;
  expiresAt: Date;
}

/** Signs and records an owner approval for the exact release package. Returns the approval id. */
export async function signAndRecordApproval(
  db: Db,
  input: { pkg: ReleasePackage; ownerId: string; choice: ApprovalChoice; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  const { keyId, privateKey, publicKey } = loadKey();
  const payload = buildApprovalPayload({
    approvalId: `apv_${randomUUID()}`,
    pkg: input.pkg,
    publishWindow: { notBefore: input.choice.notBefore.toISOString(), notAfter: input.choice.notAfter.toISOString() },
    approvedAt: now.toISOString(),
    expiresAt: input.choice.expiresAt.toISOString(),
    ownerId: input.ownerId,
    keyId,
  });
  const signed = signApproval(payload, privateKey);
  return recordApproval(db, { signed, trustedKeys: { [keyId]: publicKey }, now });
}
