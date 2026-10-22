import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildApprovalPayload,
  evaluatePublishGate,
  hashCanonical,
  releasePackageHash,
  signApproval,
  type PublishGateInput,
  type ReleasePackage,
  type ReleasePackageContent,
  type SignedApproval,
} from '../src/index';

const h = (s: string) => hashCanonical(s);
const OWNER = 'owner-1';
const ACCOUNT = 'ig-account-1';
const NOW = new Date('2026-10-23T10:00:00Z');

function pair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

function makePackage(overrides: Partial<ReleasePackageContent> = {}): ReleasePackage {
  const content: ReleasePackageContent = {
    episodeId: 'ep-1',
    episodeCode: 'LU-TECH-001',
    episodeVersionId: 'ev-1',
    episodeVersionSha256: h('version-1'),
    accountId: ACCOUNT,
    deliveryMedia: { uri: 'storage://delivery/ep-1.mp4', sha256: h('media'), bytes: 1000, mimeType: 'video/mp4' },
    cover: { uri: 'storage://covers/ep-1.jpg', sha256: h('cover'), bytes: 100, mimeType: 'image/jpeg' },
    caption: 'How your phone knows where you are. LU-TECH-001\nSources: …',
    disclosure: {
      aiGeneratedVisuals: false,
      syntheticVoice: true,
      platformLabelRequired: false,
      platformLabelMethod: 'not_applicable',
      captionNote: 'Narration uses a synthetic voice.',
    },
    shareToFeed: true,
    ...overrides,
  };
  return { ...content, id: 'pkg-1', packageSha256: releasePackageHash(content), createdAt: '2026-10-22T09:00:00Z' };
}

function approve(pkg: ReleasePackage, key: KeyObject, opts: { keyId?: string; ownerId?: string } = {}): SignedApproval {
  const payload = buildApprovalPayload({
    approvalId: 'appr-1',
    pkg,
    publishWindow: { notBefore: '2026-10-23T08:00:00Z', notAfter: '2026-10-23T20:00:00Z' },
    approvedAt: '2026-10-22T12:00:00Z',
    expiresAt: '2026-10-24T00:00:00Z',
    ownerId: opts.ownerId ?? OWNER,
    keyId: opts.keyId ?? 'studio-2026-10',
  });
  return signApproval(payload, key);
}

describe('publish gate', () => {
  let studio: ReturnType<typeof pair>;
  let pkg: ReleasePackage;
  let base: PublishGateInput;

  beforeEach(() => {
    studio = pair();
    pkg = makePackage();
    base = {
      approval: approve(pkg, studio.privateKey),
      pkg,
      observed: { deliveryMediaSha256: pkg.deliveryMedia.sha256, coverSha256: pkg.cover.sha256 },
      currentEpisodeVersionSha256: pkg.episodeVersionSha256,
      targetAccountId: ACCOUNT,
      ownerId: OWNER,
      revoked: false,
      settings: { publishingPaused: false, spendingStopped: false },
      evidence: { ok: true, blockers: [] },
      trustedKeys: { 'studio-2026-10': studio.publicKey },
      platformLabelSupported: false,
      now: NOW,
    };
  });

  const rejections = (input: PublishGateInput) => {
    const r = evaluatePublishGate(input);
    return r.ok ? [] : r.rejections;
  };

  it('passes a valid, owner-signed approval for the exact package', () => {
    expect(evaluatePublishGate(base)).toEqual({ ok: true, approvalId: 'appr-1' });
  });

  it('rejects a changed caption (new package, old approval)', () => {
    const edited = makePackage({ caption: 'A different caption LU-TECH-001' });
    expect(rejections({ ...base, pkg: edited })).toEqual(
      expect.arrayContaining(['release_package_mismatch', 'caption_mismatch']),
    );
  });

  it('rejects a caption edited in place on the stored row', () => {
    const tampered = { ...pkg, caption: 'Tampered LU-TECH-001' };
    expect(rejections({ ...base, pkg: tampered })).toEqual(
      expect.arrayContaining(['release_package_mismatch', 'caption_mismatch']),
    );
  });

  it('rejects changed delivery media, both in the package and in the bytes on disk', () => {
    const edited = makePackage({ deliveryMedia: { ...pkg.deliveryMedia, sha256: h('media-v2') } });
    expect(rejections({ ...base, pkg: edited, observed: { ...base.observed, deliveryMediaSha256: h('media-v2') } })).toContain(
      'delivery_media_mismatch',
    );
    expect(rejections({ ...base, observed: { ...base.observed, deliveryMediaSha256: h('swapped-file') } })).toEqual([
      'delivery_media_mismatch',
    ]);
  });

  it('rejects a changed cover', () => {
    expect(rejections({ ...base, observed: { ...base.observed, coverSha256: h('other-cover') } })).toEqual(['cover_mismatch']);
    const edited = makePackage({ cover: { ...pkg.cover, sha256: h('cover-v2') } });
    expect(rejections({ ...base, pkg: edited })).toContain('cover_mismatch');
  });

  it('rejects changed disclosure settings', () => {
    const edited = makePackage({ disclosure: { ...pkg.disclosure, syntheticVoice: false, captionNote: null } });
    expect(rejections({ ...base, pkg: edited })).toContain('disclosure_mismatch');
  });

  it('rejects when the episode has a newer version than the one approved', () => {
    expect(rejections({ ...base, currentEpisodeVersionSha256: h('version-2') })).toEqual(['episode_version_mismatch']);
  });

  it('rejects the wrong account', () => {
    expect(rejections({ ...base, targetAccountId: 'ig-account-2' })).toEqual(['account_mismatch']);
  });

  it('rejects a revoked approval', () => {
    expect(rejections({ ...base, revoked: true })).toEqual(['approval_revoked']);
  });

  it('rejects an expired approval', () => {
    expect(rejections({ ...base, now: new Date('2026-10-24T00:00:00Z') })).toEqual(
      expect.arrayContaining(['approval_expired']),
    );
  });

  it('rejects outside the publish window', () => {
    expect(rejections({ ...base, now: new Date('2026-10-23T07:59:59Z') })).toEqual(['outside_publish_window']);
    expect(rejections({ ...base, now: new Date('2026-10-23T20:00:01Z') })).toEqual(['outside_publish_window']);
  });

  it('rejects a forged signature', () => {
    const signed = base.approval as SignedApproval;
    const forged = { ...signed, payload: { ...signed.payload, accountId: 'ig-attacker' } };
    expect(rejections({ ...base, approval: forged })).toEqual(['signature_invalid']);
    const garbage = { ...signed, signature: Buffer.alloc(64, 7).toString('base64') };
    expect(rejections({ ...base, approval: garbage })).toEqual(['signature_invalid']);
  });

  it('rejects an approval minted by an agent with its own key, even if it claims the studio keyId', () => {
    const agent = pair();
    expect(rejections({ ...base, approval: approve(pkg, agent.privateKey) })).toEqual(['signature_invalid']);
    expect(rejections({ ...base, approval: approve(pkg, agent.privateKey, { keyId: 'agent-key' }) })).toEqual(['unknown_key']);
  });

  it('rejects an approval naming someone other than the owner', () => {
    expect(rejections({ ...base, approval: approve(pkg, studio.privateKey, { ownerId: 'someone-else' }) })).toEqual([
      'approver_not_owner',
    ]);
  });

  it('rejects malformed approvals and extra fields', () => {
    expect(rejections({ ...base, approval: null })).toEqual(['payload_invalid']);
    const signed = base.approval as SignedApproval;
    expect(rejections({ ...base, approval: { ...signed, payload: { ...signed.payload, extra: 1 } } })).toEqual([
      'payload_invalid',
    ]);
  });

  it('rejects while publishing is globally paused', () => {
    expect(rejections({ ...base, settings: { publishingPaused: true, spendingStopped: false } })).toEqual(['publishing_paused']);
  });

  it('rejects when the spending stop is on', () => {
    expect(rejections({ ...base, settings: { publishingPaused: false, spendingStopped: true } })).toEqual(['spending_stopped']);
  });

  it('rejects when the evidence gate blocks', () => {
    const r = evaluatePublishGate({ ...base, evidence: { ok: false, blockers: ['claim c-3 is stale'] } });
    expect(r).toEqual({ ok: false, rejections: ['evidence_blocked'], details: ['claim c-3 is stale'] });
  });

  it('holds publication when a required platform AI label cannot be applied', () => {
    const labelled = makePackage({
      disclosure: { ...pkg.disclosure, aiGeneratedVisuals: true, platformLabelRequired: true, platformLabelMethod: 'api' },
    });
    const input = { ...base, pkg: labelled, approval: approve(labelled, studio.privateKey) };
    expect(rejections(input)).toEqual(['disclosure_unsupported']);
    expect(rejections({ ...input, platformLabelSupported: true })).toEqual([]);
  });

  it('reports every failing condition at once', () => {
    const r = rejections({ ...base, revoked: true, targetAccountId: 'x', settings: { publishingPaused: true, spendingStopped: false } });
    expect(r).toEqual(expect.arrayContaining(['approval_revoked', 'account_mismatch', 'publishing_paused']));
  });
});
