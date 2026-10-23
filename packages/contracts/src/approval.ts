import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { hashCanonical, canonicalJson } from './canonical';
import { Id, IsoDateTime, Sha256 } from './common';

export const Disclosure = z.object({
  /** Realistic generated imagery or video is present. */
  aiGeneratedVisuals: z.boolean(),
  /** The narration is synthetic speech. */
  syntheticVoice: z.boolean(),
  /** Whether a platform AI label must be applied before publishing. */
  platformLabelRequired: z.boolean(),
  /** How the platform label will be applied; publishing holds if it is required but unsupported. */
  platformLabelMethod: z.enum(['api', 'owner_manual', 'not_applicable']),
  captionNote: z.string().nullable(),
});
export type Disclosure = z.infer<typeof Disclosure>;

export const MediaRef = z.object({
  uri: z.string().min(1),
  sha256: Sha256,
  bytes: z.number().int().positive(),
  mimeType: z.string().min(1),
});
export type MediaRef = z.infer<typeof MediaRef>;

/** Everything the owner sees and approves. The package hash covers all of it. */
export const ReleasePackageContent = z.object({
  episodeId: Id,
  episodeCode: z.string().min(1),
  episodeVersionId: Id,
  episodeVersionSha256: Sha256,
  accountId: Id,
  deliveryMedia: MediaRef,
  cover: MediaRef,
  /**
   * 'first_frame': the cover image is the delivery video's first frame, and Instagram is told
   * to use that frame, so the approved cover is exactly what appears. Absent = a separate image.
   */
  coverSource: z.enum(['first_frame', 'separate_image']).optional(),
  caption: z.string().min(1).max(2200),
  disclosure: Disclosure,
  shareToFeed: z.boolean(),
});
export type ReleasePackageContent = z.infer<typeof ReleasePackageContent>;

export const ReleasePackage = ReleasePackageContent.extend({
  id: Id,
  packageSha256: Sha256,
  createdAt: IsoDateTime,
});
export type ReleasePackage = z.infer<typeof ReleasePackage>;

export function releasePackageHash(content: ReleasePackageContent): string {
  return hashCanonical(ReleasePackageContent.parse(content));
}

export const PublishWindow = z
  .strictObject({ notBefore: IsoDateTime, notAfter: IsoDateTime })
  .refine((w) => Date.parse(w.notBefore) < Date.parse(w.notAfter), 'notBefore must precede notAfter');
export type PublishWindow = z.infer<typeof PublishWindow>;

export const ApprovalPayload = z.strictObject({
  v: z.literal(1),
  approvalId: Id,
  episodeId: Id,
  episodeVersionId: Id,
  episodeVersionSha256: Sha256,
  releasePackageId: Id,
  releasePackageSha256: Sha256,
  deliveryMediaSha256: Sha256,
  coverSha256: Sha256,
  captionSha256: Sha256,
  disclosureSha256: Sha256,
  accountId: Id,
  publishWindow: PublishWindow,
  approvedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  approver: z.strictObject({ kind: z.literal('owner'), ownerId: Id }),
  keyId: z.string().min(1),
});
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;

export const SignedApproval = z.strictObject({
  payload: ApprovalPayload,
  /** base64 Ed25519 signature over canonicalJson(payload). */
  signature: z.string().min(1),
});
export type SignedApproval = z.infer<typeof SignedApproval>;

export interface ApprovalBindingInput {
  approvalId: string;
  pkg: ReleasePackage;
  publishWindow: PublishWindow;
  approvedAt: string;
  expiresAt: string;
  ownerId: string;
  keyId: string;
}

export function buildApprovalPayload(input: ApprovalBindingInput): ApprovalPayload {
  const { pkg } = input;
  return ApprovalPayload.parse({
    v: 1,
    approvalId: input.approvalId,
    episodeId: pkg.episodeId,
    episodeVersionId: pkg.episodeVersionId,
    episodeVersionSha256: pkg.episodeVersionSha256,
    releasePackageId: pkg.id,
    releasePackageSha256: pkg.packageSha256,
    deliveryMediaSha256: pkg.deliveryMedia.sha256,
    coverSha256: pkg.cover.sha256,
    captionSha256: hashCanonical(pkg.caption),
    disclosureSha256: hashCanonical(pkg.disclosure),
    accountId: pkg.accountId,
    publishWindow: input.publishWindow,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    approver: { kind: 'owner', ownerId: input.ownerId },
    keyId: input.keyId,
  });
}

/**
 * Signs an approval. Only the studio process calls this, with the owner's
 * approval key from local config. Workers and agents never hold that key.
 */
export function signApproval(payload: ApprovalPayload, privateKey: KeyObject | string): SignedApproval {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('approval key must be Ed25519');
  const parsed = ApprovalPayload.parse(payload);
  const signature = sign(null, Buffer.from(canonicalJson(parsed)), key).toString('base64');
  return { payload: parsed, signature };
}

export type TrustedApprovalKeys = Readonly<Record<string, KeyObject | string>>;

export type SignatureCheck = { ok: true } | { ok: false; reason: 'unknown_key' | 'signature_invalid' | 'payload_invalid' };

export function verifyApprovalSignature(signed: unknown, trustedKeys: TrustedApprovalKeys): SignatureCheck {
  const parsed = SignedApproval.safeParse(signed);
  if (!parsed.success) return { ok: false, reason: 'payload_invalid' };
  const raw = trustedKeys[parsed.data.payload.keyId];
  if (!raw) return { ok: false, reason: 'unknown_key' };
  try {
    const key = typeof raw === 'string' ? createPublicKey(raw) : raw;
    if (key.asymmetricKeyType !== 'ed25519') return { ok: false, reason: 'unknown_key' };
    const good = verify(
      null,
      Buffer.from(canonicalJson(parsed.data.payload)),
      key,
      Buffer.from(parsed.data.signature, 'base64'),
    );
    return good ? { ok: true } : { ok: false, reason: 'signature_invalid' };
  } catch {
    return { ok: false, reason: 'signature_invalid' };
  }
}
