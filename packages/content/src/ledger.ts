import { hashCanonical, type Claim, type ClaimEvidence } from '@life/contracts';

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Hash of the claim ledger a version was verified against:
 * `hashCanonical({ claims, evidence })` with both arrays sorted by `id`.
 * Input order does not matter; any field change does.
 *
 * Convention: callers pass the whole packet (`packet.claims`, `packet.evidence`);
 * the evidence gate recomputes it the same way and blocks on mismatch.
 */
export function claimLedgerSha256(claims: Claim[], evidence: ClaimEvidence[]): string {
  return hashCanonical({ claims: [...claims].sort(byId), evidence: [...evidence].sort(byId) });
}
