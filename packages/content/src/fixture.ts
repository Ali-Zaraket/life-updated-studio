/**
 * FIXTURE — development only. Not a real episode and not real research.
 *
 * Every source lives on the reserved `.invalid` TLD (RFC 6761), every title is
 * prefixed "[FIXTURE]", and every passage says it is a placeholder, so nothing
 * here can be mistaken for, or published as, a real citation. The episode code
 * LU-TECH-001 is placeholder text.
 */
import { reviewSubjectSha256, type Claim, type ClaimEvidence, type EpisodeLink, type EpisodeVersionContent, type ReviewRecord, type Source, type Topic } from '@life/contracts';
import type { EvidencePacket } from './types';
import { claimLedgerSha256 } from './ledger';

export const FIXTURE_EPISODE_CODE = 'LU-TECH-001';
export const FIXTURE_TOPIC_ID = 'fixture-topic-tech-location';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface FixtureBundle {
  packet: EvidencePacket;
  version: Omit<EpisodeVersionContent, 'episodeId' | 'versionNumber' | 'claimLedgerSha256'>;
  link: Omit<EpisodeLink, 'episodeId'>;
}

export function fixturePacket(now: Date): FixtureBundle {
  const t = now.getTime();
  const at = (offsetMs: number) => new Date(t + offsetMs).toISOString();
  const day = (offsetMs: number) => at(offsetMs).slice(0, 10);

  const topic: Topic = {
    id: FIXTURE_TOPIC_ID,
    pillar: 'technology',
    title: '[FIXTURE] How apps get permission to see your location',
    question: 'How does your phone decide which apps can see your location?',
    riskTier: 'low',
    intent: {
      whoThisHelps: '[FIXTURE] Phone users who tap through location prompts without knowing what they allow.',
      whatTheyLearn: 'The operating system gates location services behind a permission the user controls.',
      whatTheyCanDo: 'Review location access in settings and switch it off for apps that do not need it.',
      whyEvidenceSupportsIt: 'Placeholder: platform documentation describing the permission model (fixture sources only).',
      whatEvidenceDoesNotEstablish:
        'That denying the permission hides location completely; approximate location can be inferred by other means.',
    },
    isFixture: true,
    createdAt: at(-2 * DAY),
  };

  const source = (n: number, slug: string, title: string, originId: string, sourceType: Source['sourceType']): Source => ({
    id: `fixture-source-${n}`,
    url: `https://fixture-source-${n}.invalid/${slug}`,
    doi: null,
    title: `[FIXTURE] ${title}`,
    authors: [],
    institution: null,
    sourceType,
    publishedAt: null,
    retrievedAt: at(-2 * HOUR),
    originId,
    available: true,
    retractionCheckedAt: at(-2 * HOUR),
    retracted: false,
    correctionNote: null,
    contentSha256: null,
  });

  const sources: Source[] = [
    source(1, 'platform-a/location-permissions', 'Platform A location permission documentation (placeholder)', 'fixture-origin-platform-a', 'official_documentation'),
    source(2, 'platform-b/location-access', 'Platform B location access documentation (placeholder)', 'fixture-origin-platform-b', 'official_documentation'),
    source(3, 'research/location-inference', 'Overview of location inference from network signals (placeholder)', 'fixture-origin-research', 'other'),
  ];

  const base = {
    topicId: FIXTURE_TOPIC_ID,
    statusReason: null,
    riskTier: 'low' as const,
    isNumeric: false,
    isCausal: false,
    singleOriginJustification: null,
  };

  const claims: Claim[] = [
    {
      ...base,
      id: 'fixture-claim-permission-gate',
      text: 'On major mobile operating systems, an app must be granted location permission by the user before it can read location from the system location services.',
      locations: ['hook', 'narration', 'caption'],
      status: 'supported',
      // Product behavior can change with OS releases.
      timeSensitivity: 'changing',
      freshUntil: at(12 * HOUR),
      lastCheckedAt: at(-1 * HOUR),
      permittedWording: null,
      limitations: null,
      isConsequential: true,
    },
    {
      ...base,
      id: 'fixture-claim-precision-options',
      text: 'Many phones let users grant approximate instead of precise location, or allow access only while the app is in use.',
      locations: ['narration'],
      status: 'supported_with_limits',
      timeSensitivity: 'changing',
      freshUntil: at(12 * HOUR),
      lastCheckedAt: at(-1 * HOUR),
      permittedWording: 'options vary by phone',
      limitations: 'Option names and availability differ between operating systems and versions.',
      isConsequential: false,
    },
    {
      ...base,
      id: 'fixture-claim-settings-review',
      text: 'Location access for each app can be reviewed and changed in the phone settings.',
      locations: ['narration', 'caption'],
      status: 'supported',
      timeSensitivity: 'stable',
      freshUntil: at(30 * DAY),
      lastCheckedAt: at(-1 * HOUR),
      permittedWording: null,
      limitations: null,
      isConsequential: false,
    },
    {
      ...base,
      id: 'fixture-claim-inference',
      text: 'Approximate location can sometimes be estimated from other information, such as network signals, without the location permission.',
      locations: ['ending'],
      status: 'supported_with_limits',
      timeSensitivity: 'stable',
      freshUntil: at(30 * DAY),
      lastCheckedAt: at(-1 * HOUR),
      permittedWording: 'can sometimes be estimated',
      limitations: 'Accuracy varies widely; this does not mean every app does it.',
      isConsequential: true,
    },
  ];

  let n = 0;
  const ev = (claimId: string, sourceId: string): ClaimEvidence => ({
    id: `fixture-evidence-${++n}`,
    claimId,
    sourceId,
    stance: 'supports',
    supportingPassage: '[FIXTURE] Placeholder passage standing in for the supporting text of a real source.',
    locator: '[FIXTURE] section placeholder',
    studyType: null,
    population: null,
    limitations: null,
    createdAt: at(-2 * HOUR),
  });

  const evidence: ClaimEvidence[] = [
    ev('fixture-claim-permission-gate', 'fixture-source-1'),
    ev('fixture-claim-permission-gate', 'fixture-source-2'),
    ev('fixture-claim-precision-options', 'fixture-source-1'),
    ev('fixture-claim-precision-options', 'fixture-source-2'),
    ev('fixture-claim-settings-review', 'fixture-source-1'),
    ev('fixture-claim-inference', 'fixture-source-3'),
    ev('fixture-claim-inference', 'fixture-source-2'),
  ];

  const reviews: ReviewRecord[] = claims.map((c, i) => ({
    id: `fixture-review-${i + 1}`,
    claimId: c.id,
    episodeVersionId: null,
    reviewerKind: 'ai_verification',
    reviewer: 'fixture',
    verdict: 'pass',
    notes: '[FIXTURE] Placeholder verification record; not a real review.',
    documentRef: null,
    authorizedDisplayWording: null,
    createdAt: at(-1 * HOUR),
  }));

  const sourceList = sources.map((s) => `${s.title}, retrieved ${day(-2 * HOUR)}`);

  const version: FixtureBundle['version'] = {
    beats: [
      {
        startSec: 0,
        endSec: 3,
        role: 'hook',
        narration: 'Your phone just asked if an app can use your location. Who actually decides?',
        visual: '[FIXTURE] Close-up of a generic, unbranded location permission prompt.',
        claimIds: ['fixture-claim-permission-gate'],
      },
      {
        startSec: 3,
        endSec: 10,
        role: 'problem',
        narration: 'Those prompts are easy to tap through without knowing what you just allowed.',
        visual: '[FIXTURE] A thumb hovering over the prompt, then the prompt dismissed.',
        claimIds: ['fixture-claim-permission-gate'],
      },
      {
        startSec: 10,
        endSec: 24,
        role: 'mechanism',
        narration:
          'The operating system sits in between: an app can read location services only after you grant permission. Many phones also let you choose approximate or precise location, or allow it only while using the app, though the exact options vary by phone.',
        visual: '[FIXTURE] Labelled diagram: app, operating system gate, location services.',
        claimIds: ['fixture-claim-permission-gate', 'fixture-claim-precision-options'],
      },
      {
        startSec: 24,
        endSec: 30,
        role: 'takeaway',
        narration: "So open your settings, check which apps have location access, and switch off any that don't need it.",
        visual: '[FIXTURE] Generic settings list with location toggles.',
        claimIds: ['fixture-claim-settings-review'],
      },
      {
        startSec: 30,
        endSec: 35,
        role: 'twist',
        narration:
          'But your location can sometimes be estimated without that permission, from clues like your network. That is a different mechanism, and a question worth asking next.',
        visual: '[FIXTURE] The location gate stays closed while a faint network signal map appears.',
        claimIds: ['fixture-claim-inference'],
      },
    ],
    caption: [
      '[FIXTURE — development only, not for publication]',
      'How does your phone decide which apps can see your location? The operating system asks you first, and you can change it in settings; the exact options vary by phone.',
      `Episode ${FIXTURE_EPISODE_CODE} (placeholder code).`,
      '',
      'Sources (fixture placeholders, not real citations):',
      ...sourceList.map((s) => `- ${s}`),
      'Limits: option names differ by phone, and location can sometimes be estimated by other means.',
    ].join('\n'),
    sourceList,
    claimIds: claims.map((c) => c.id),
  };

  const link: FixtureBundle['link'] = {
    parentQuestion: null,
    resolvedQuestion: 'How does your phone decide which apps can see your location?',
    nextQuestion: 'How can location be estimated without the location permission?',
    relatedEpisodeId: null,
    relationshipReason: 'Second mechanism: inference from other information. Future episode, not yet produced.',
    endingReferencesRelated: false,
  };

  // Fixture reviews are bound to this exact fixture script, like real ones.
  const subjectSha256 = reviewSubjectSha256({ ...version, claimLedgerSha256: claimLedgerSha256(claims, evidence) });
  for (const r of reviews) r.subjectSha256 = subjectSha256;

  return { packet: { topic, sources, claims, evidence, reviews }, version, link };
}
