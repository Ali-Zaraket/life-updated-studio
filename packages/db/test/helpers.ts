import { generateKeyPairSync } from 'node:crypto';
import {
  buildApprovalPayload,
  hashCanonical,
  signApproval,
  type Actor,
  type ReleasePackage,
  type Topic,
} from '@life/contracts';
import {
  createEpisode,
  createEpisodeVersion,
  createReleasePackage,
  ensureOwner,
  openPgliteDb,
  saveEvidencePacket,
  transitionEpisode,
  type Db,
} from '../src/index';

export const OWNER_ID = 'owner-1';
export const owner: Actor = { kind: 'owner', ownerId: OWNER_ID };
export const system: Actor = { kind: 'system', component: 'test' };
export const agent: Actor = { kind: 'agent', agentName: 'studio', model: 'claude-sonnet-5-5' };

export const topic: Topic = {
  id: 'topic-1',
  pillar: 'technology',
  title: '[FIXTURE] Location permissions',
  question: 'How do apps get your location?',
  riskTier: 'low',
  intent: {
    whoThisHelps: 'phone users',
    whatTheyLearn: 'how location permission works',
    whatTheyCanDo: 'review permissions',
    whyEvidenceSupportsIt: 'fixture',
    whatEvidenceDoesNotEstablish: 'fixture',
  },
  isFixture: true,
  createdAt: '2026-10-22T00:00:00.000Z',
};

export const versionContent = (caption = 'Fixture caption LU-TECH-001') => ({
  beats: [{ startSec: 0, endSec: 5, role: 'hook' as const, narration: 'Fixture narration.', visual: 'fixture', claimIds: [] }],
  caption,
  sourceList: ['[FIXTURE] source'],
  claimIds: [],
  claimLedgerSha256: hashCanonical('ledger'),
});

export async function freshDb() {
  const handle = await openPgliteDb();
  await ensureOwner(handle.db, { id: OWNER_ID, displayName: 'Owner' });
  await saveEvidencePacket(handle.db, { topic, sources: [], claims: [], evidence: [], reviews: [] });
  return handle;
}

const WALK = ['researching', 'evidence_ready', 'scripted', 'verified', 'preview_ready', 'awaiting_user_approval'] as const;

/** Episode with one version and a release package, waiting for approval. */
export async function episodeAwaitingApproval(db: Db, code = 'LU-TECH-001') {
  const episodeId = await createEpisode(db, { code, topicId: topic.id, format: 'everyday_mystery', actor: agent });
  await transitionEpisode(db, { episodeId, to: 'researching', actor: agent });
  await transitionEpisode(db, { episodeId, to: 'evidence_ready', actor: agent });
  const version = await createEpisodeVersion(db, { episodeId, content: versionContent(`Caption ${code}`), actor: agent });
  for (const to of WALK.slice(2)) await transitionEpisode(db, { episodeId, to, actor: agent });
  const pkg = await createReleasePackage(db, {
    actor: agent,
    content: {
      episodeId,
      episodeCode: code,
      episodeVersionId: version.id,
      episodeVersionSha256: version.contentSha256,
      accountId: 'ig-1',
      deliveryMedia: { uri: 'mock://m.mp4', sha256: hashCanonical('m'), bytes: 10, mimeType: 'video/mp4' },
      cover: { uri: 'mock://c.jpg', sha256: hashCanonical('c'), bytes: 10, mimeType: 'image/jpeg' },
      caption: `Caption ${code}`,
      disclosure: { aiGeneratedVisuals: false, syntheticVoice: true, platformLabelRequired: false, platformLabelMethod: 'not_applicable', captionNote: null },
      shareToFeed: true,
    },
  });
  return { episodeId, version, pkg };
}

export const studioKeys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, trusted: { 'studio-test': publicKey } };
};

export function signFor(pkg: ReleasePackage, privateKey: ReturnType<typeof studioKeys>['privateKey'], approvalId = `appr-${pkg.id}`) {
  return signApproval(
    buildApprovalPayload({
      approvalId,
      pkg,
      publishWindow: { notBefore: '2026-10-22T00:00:00Z', notAfter: '2026-10-30T00:00:00Z' },
      approvedAt: '2026-10-22T10:00:00Z',
      expiresAt: '2026-10-31T00:00:00Z',
      ownerId: OWNER_ID,
      keyId: 'studio-test',
    }),
    privateKey,
  );
}
