import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claimLedgerSha256, fixturePacket, FIXTURE_EPISODE_CODE } from '@life/content';
import { buildApprovalPayload, signApproval, type Actor } from '@life/contracts';
import { createEpisode, createEpisodeVersion, createReleasePackage, ensureOwner, recordApproval, saveEvidencePacket, transitionEpisode, type Db } from '@life/db';
import { sha256File } from '@life/media';
import { LocalStorage } from '../src/index';

export const OWNER = 'owner';
export const ACCOUNT = 'mock-account';
const sys: Actor = { kind: 'system', component: 'test' };

/** A verified fixture episode with a release package and a (test-key) owner approval. */
export async function approvedFixture(db: Db, root: string, T0: Date) {
  await ensureOwner(db, { id: OWNER, displayName: 'Owner' });
  const fx = fixturePacket(T0);
  await saveEvidencePacket(db, fx.packet);
  const episodeId = await createEpisode(db, { code: FIXTURE_EPISODE_CODE, topicId: fx.packet.topic.id, format: 'everyday_mystery', actor: sys, now: T0 });
  for (const to of ['researching', 'evidence_ready'] as const) await transitionEpisode(db, { episodeId, to, actor: sys, now: T0 });
  const version = await createEpisodeVersion(db, {
    episodeId,
    content: { ...fx.version, claimLedgerSha256: claimLedgerSha256(fx.packet.claims, fx.packet.evidence) },
    actor: sys,
    now: T0,
  });
  for (const to of ['scripted', 'verified', 'preview_ready'] as const) await transitionEpisode(db, { episodeId, to, actor: sys, now: T0 });

  const storage = new LocalStorage(root);
  const media = join(root, 'src.mp4');
  const cover = join(root, 'src.jpg');
  await writeFile(media, 'MOCK video bytes');
  await writeFile(cover, 'MOCK cover bytes');
  const deliveryUri = await storage.put(media, 'ep/MOCK_delivery.mp4');
  const coverUri = await storage.put(cover, 'ep/MOCK_cover.jpg');
  const pkg = await createReleasePackage(db, {
    actor: sys,
    now: T0,
    content: {
      episodeId,
      episodeCode: FIXTURE_EPISODE_CODE,
      episodeVersionId: version.id,
      episodeVersionSha256: version.contentSha256,
      accountId: ACCOUNT,
      deliveryMedia: { uri: deliveryUri, sha256: await sha256File(storage.resolve(deliveryUri)), bytes: 16, mimeType: 'video/mp4' },
      cover: { uri: coverUri, sha256: await sha256File(storage.resolve(coverUri)), bytes: 16, mimeType: 'image/jpeg' },
      caption: fx.version.caption,
      disclosure: { aiGeneratedVisuals: false, syntheticVoice: true, platformLabelRequired: false, platformLabelMethod: 'not_applicable', captionNote: 'Synthetic voice.' },
      shareToFeed: true,
    },
  });
  await transitionEpisode(db, { episodeId, to: 'awaiting_user_approval', actor: sys, now: T0 });

  const keys = generateKeyPairSync('ed25519');
  const trustedKeys = { 'studio-test': keys.publicKey };
  const signed = signApproval(
    buildApprovalPayload({
      approvalId: 'appr-1',
      pkg,
      publishWindow: { notBefore: T0.toISOString(), notAfter: new Date(T0.getTime() + 48 * 3_600_000).toISOString() },
      approvedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + 48 * 3_600_000).toISOString(),
      ownerId: OWNER,
      keyId: 'studio-test',
    }),
    keys.privateKey,
  );
  const approvalId = await recordApproval(db, { signed, trustedKeys, now: T0 });
  return { episodeId, version, pkg, storage, trustedKeys, approvalId, fx };
}

