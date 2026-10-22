import { hashCanonical } from './canonical';
import {
  releasePackageHash,
  verifyApprovalSignature,
  type SignedApproval,
  type ReleasePackage,
  type TrustedApprovalKeys,
} from './approval';

export type GateRejection =
  | 'payload_invalid'
  | 'unknown_key'
  | 'signature_invalid'
  | 'approver_not_owner'
  | 'episode_version_mismatch'
  | 'release_package_mismatch'
  | 'delivery_media_mismatch'
  | 'cover_mismatch'
  | 'caption_mismatch'
  | 'disclosure_mismatch'
  | 'disclosure_unsupported'
  | 'account_mismatch'
  | 'approval_revoked'
  | 'approval_expired'
  | 'outside_publish_window'
  | 'publishing_paused'
  | 'spending_stopped'
  | 'evidence_blocked';

export interface EvidenceGateSummary {
  ok: boolean;
  blockers: readonly string[];
}

export interface PublishGateInput {
  /** The signed approval exactly as stored. Treated as untrusted. */
  approval: unknown;
  /** The release package as currently stored. */
  pkg: ReleasePackage;
  /** Hashes the worker computed from the actual bytes it is about to upload. */
  observed: { deliveryMediaSha256: string; coverSha256: string };
  /** The current hash of the episode version the package points at. */
  currentEpisodeVersionSha256: string;
  /** The account the worker is configured to publish to. */
  targetAccountId: string;
  /** The single configured owner. */
  ownerId: string;
  revoked: boolean;
  settings: { publishingPaused: boolean; spendingStopped: boolean };
  evidence: EvidenceGateSummary;
  trustedKeys: TrustedApprovalKeys;
  /** Whether the active publisher can apply a required platform AI label. */
  platformLabelSupported: boolean;
  now: Date;
}

export type PublishGateResult =
  | { ok: true; approvalId: string }
  | { ok: false; rejections: GateRejection[]; details: string[] };

/**
 * The last check before the worker publishes. Every condition is evaluated so
 * the owner sees all reasons at once; any rejection blocks.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const rejections = new Set<GateRejection>();
  const details: string[] = [];
  const reject = (r: GateRejection, detail?: string) => {
    rejections.add(r);
    if (detail) details.push(detail);
  };

  if (input.settings.publishingPaused) reject('publishing_paused');
  if (input.settings.spendingStopped) reject('spending_stopped');
  if (!input.evidence.ok) reject('evidence_blocked', ...input.evidence.blockers.slice(0, 1));
  if (input.revoked) reject('approval_revoked');

  const sig = verifyApprovalSignature(input.approval, input.trustedKeys);
  if (!sig.ok) {
    reject(sig.reason);
    return { ok: false, rejections: [...rejections], details };
  }
  // Signature verified, so the shape is valid.
  const { payload } = input.approval as SignedApproval;
  const { pkg } = input;

  if (payload.approver.kind !== 'owner' || payload.approver.ownerId !== input.ownerId) reject('approver_not_owner');

  // Bind to the package as stored *and* recompute its hash so a tampered row is caught.
  const { id: _id, packageSha256: storedPackageHash, createdAt: _c, ...content } = pkg;
  const recomputed = releasePackageHash(content);
  if (
    payload.releasePackageId !== pkg.id ||
    payload.releasePackageSha256 !== storedPackageHash ||
    payload.releasePackageSha256 !== recomputed
  ) {
    reject('release_package_mismatch');
  }
  if (
    payload.episodeId !== pkg.episodeId ||
    payload.episodeVersionId !== pkg.episodeVersionId ||
    payload.episodeVersionSha256 !== pkg.episodeVersionSha256 ||
    payload.episodeVersionSha256 !== input.currentEpisodeVersionSha256
  ) {
    reject('episode_version_mismatch');
  }
  if (payload.deliveryMediaSha256 !== pkg.deliveryMedia.sha256 || payload.deliveryMediaSha256 !== input.observed.deliveryMediaSha256) {
    reject('delivery_media_mismatch');
  }
  if (payload.coverSha256 !== pkg.cover.sha256 || payload.coverSha256 !== input.observed.coverSha256) reject('cover_mismatch');
  if (payload.captionSha256 !== hashCanonical(pkg.caption)) reject('caption_mismatch');
  if (payload.disclosureSha256 !== hashCanonical(pkg.disclosure)) reject('disclosure_mismatch');
  if (pkg.disclosure.platformLabelRequired && !(pkg.disclosure.platformLabelMethod === 'api' && input.platformLabelSupported)) {
    reject('disclosure_unsupported', 'platform AI label required but cannot be applied through this publisher');
  }
  if (payload.accountId !== pkg.accountId || payload.accountId !== input.targetAccountId) reject('account_mismatch');

  const now = input.now.getTime();
  if (now >= Date.parse(payload.expiresAt)) reject('approval_expired');
  if (now < Date.parse(payload.publishWindow.notBefore) || now > Date.parse(payload.publishWindow.notAfter)) {
    reject('outside_publish_window');
  }

  return rejections.size === 0
    ? { ok: true, approvalId: payload.approvalId }
    : { ok: false, rejections: [...rejections], details };
}
