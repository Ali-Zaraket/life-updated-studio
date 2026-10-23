import { reviewSubjectSha256, type EpisodeLink, type EpisodeVersionContent, type ReviewRecord } from '@life/contracts';
import { expect } from 'vitest';
import {
  claimLedgerSha256,
  evaluateCreativeRules,
  evaluateEvidenceGate,
  fixturePacket,
  type EvidencePacket,
  type GateReport,
} from '../src/index';

export const NOW = new Date('2026-10-22T12:00:00.000Z');
export const HOUR = 60 * 60 * 1000;
export const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

export interface World {
  packet: EvidencePacket;
  version: EpisodeVersionContent;
  link: EpisodeLink;
  relatedEpisodeLive: boolean;
}

/** A fresh, passing fixture world. Mutate it, then call `evidence()` / `creative()`. */
export function world(now: Date = NOW): World {
  const f = structuredClone(fixturePacket(now));
  return {
    packet: f.packet,
    version: {
      ...f.version,
      episodeId: 'fixture-episode-1',
      versionNumber: 1,
      claimLedgerSha256: claimLedgerSha256(f.packet.claims, f.packet.evidence),
    },
    link: { ...f.link, episodeId: 'fixture-episode-1' },
    relatedEpisodeLive: false,
  };
}

/** Re-seal the ledger hash after a deliberate packet mutation, so only the rule under test fires. */
export function reseal(w: World): World {
  w.version.claimLedgerSha256 = claimLedgerSha256(w.packet.claims, w.packet.evidence);
  return w;
}

/**
 * Evaluates the evidence gate. Fixture AI reviews are re-bound to the current
 * script first, so a test that edits the script isolates the rule under test;
 * pass `{ keepReviewBinding: true }` to test the binding itself.
 */
export const evidence = (w: World, now: Date = NOW, opts: { keepReviewBinding?: boolean } = {}): GateReport => {
  if (!opts.keepReviewBinding) {
    const subject = reviewSubjectSha256(w.version);
    for (const r of w.packet.reviews) if (r.reviewer === 'fixture') r.subjectSha256 = subject;
  }
  return evaluateEvidenceGate({ packet: w.packet, version: w.version, now });
};

export const creative = (w: World): GateReport =>
  evaluateCreativeRules({ version: w.version, link: w.link, relatedEpisodeLive: w.relatedEpisodeLive, reviews: w.packet.reviews });

export const codes = (r: GateReport): string[] => [...new Set(r.issues.map((i) => i.code))];

export function claim(w: World, id: string) {
  const c = w.packet.claims.find((x) => x.id === id);
  if (!c) throw new Error(`no claim ${id}`);
  return c;
}

export function beat(w: World, role: EpisodeVersionContent['beats'][number]['role']) {
  const b = w.version.beats.find((x) => x.role === role);
  if (!b) throw new Error(`no ${role} beat`);
  return b;
}

/** Records every code a test proved, so a coverage test can assert none is untested. */
export const proven = new Set<string>();

/** Asserts the report blocks with `code` (and optionally only that code), and records it. */
export function expectBlocked(r: GateReport, code: string, opts: { only?: boolean; claimId?: string } = {}): void {
  expect(r.ok).toBe(false);
  expect(codes(r)).toContain(code);
  if (opts.only) expect(codes(r)).toEqual([code]);
  if (opts.claimId) expect(r.issues.some((i) => i.code === code && i.claimId === opts.claimId)).toBe(true);
  expect(r.blockers).toEqual(r.issues.map((i) => `${i.code}: ${i.message}`));
  proven.add(code);
}

export function humanReview(overrides: Partial<ReviewRecord> & Pick<ReviewRecord, 'id'>): ReviewRecord {
  return {
    claimId: null,
    episodeVersionId: null,
    reviewerKind: 'qualified_human',
    reviewer: '[FIXTURE] qualified reviewer as supplied by the owner',
    verdict: 'pass',
    notes: '[FIXTURE] placeholder',
    documentRef: 'fixture-doc-ref-1',
    authorizedDisplayWording: null,
    createdAt: iso(-HOUR),
    ...overrides,
  };
}

export const C = {
  gate: 'fixture-claim-permission-gate',
  options: 'fixture-claim-precision-options',
  settings: 'fixture-claim-settings-review',
  inference: 'fixture-claim-inference',
} as const;
