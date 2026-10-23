import type { Claim, ClaimEvidence, ReviewRecord, Source, Topic } from '@life/contracts';

/** Everything known about one topic's evidence, as stored. Treated as untrusted. */
export interface EvidencePacket {
  topic: Topic;
  sources: Source[];
  claims: Claim[];
  evidence: ClaimEvidence[];
  reviews: ReviewRecord[];
}

export interface GateIssue {
  code: string;
  claimId: string | null;
  message: string;
}

/** Structurally compatible with `EvidenceGateSummary` from contracts. */
export interface GateReport {
  ok: boolean;
  /** `issues.map(i => `${i.code}: ${i.message}`)` */
  blockers: string[];
  issues: GateIssue[];
}

/** Collects issues, drops exact duplicates, preserves first-seen order. */
export class IssueList {
  private readonly items: GateIssue[] = [];
  private readonly seen = new Set<string>();

  add(code: string, claimId: string | null, message: string): void {
    const key = `${code}\u0000${claimId ?? ''}\u0000${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ code, claimId, message });
  }

  report(): GateReport {
    const issues = [...this.items];
    return { ok: issues.length === 0, blockers: issues.map((i) => `${i.code}: ${i.message}`), issues };
  }
}
