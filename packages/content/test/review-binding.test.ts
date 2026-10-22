import { describe, expect, it } from 'vitest';
import { reviewSubjectSha256 } from '@life/contracts';
import { beat, evidence, world } from './helpers';

const aiIssues = (r: ReturnType<typeof evidence>) => r.issues.filter((i) => i.code === 'missing_ai_verification');

describe('AI verification is bound to the exact script', () => {
  it('passes when every claim has a clean pass of this script', () => {
    expect(evidence(world(), undefined, { keepReviewBinding: true }).ok).toBe(true);
  });

  it('a review of an earlier draft does not count after the script changes', () => {
    const w = world();
    beat(w, 'takeaway').narration += ' Check it once a month.';
    const r = evidence(w, undefined, { keepReviewBinding: true });
    expect(aiIssues(r).length).toBe(w.packet.claims.length);
    expect(aiIssues(r)[0]!.message).toMatch(/different version of the script/);
  });

  it('a caption-only change also needs a fresh review', () => {
    const w = world();
    w.version.caption += '\nNew line.';
    expect(aiIssues(evidence(w, undefined, { keepReviewBinding: true })).length).toBeGreaterThan(0);
  });

  it('pass_with_changes blocks until the changes are made and re-reviewed', () => {
    const w = world();
    w.packet.reviews[0]!.verdict = 'pass_with_changes';
    const issues = aiIssues(evidence(w, undefined, { keepReviewBinding: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/apply them and get a fresh review/);
  });

  it('a newer clean pass on the revised script clears it', () => {
    const w = world();
    beat(w, 'takeaway').narration += ' Check it once a month.';
    const subject = reviewSubjectSha256(w.version);
    w.packet.reviews.push(
      ...w.packet.claims.map((c, i) => ({ ...w.packet.reviews[0]!, id: `fresh-${i}`, claimId: c.id, subjectSha256: subject, createdAt: '2026-10-22T11:59:00.000Z' })),
    );
    expect(aiIssues(evidence(w, undefined, { keepReviewBinding: true }))).toHaveLength(0);
  });

  it('reviews without a subject never count', () => {
    const w = world();
    for (const r of w.packet.reviews) r.subjectSha256 = null;
    expect(aiIssues(evidence(w, undefined, { keepReviewBinding: true })).length).toBe(w.packet.claims.length);
  });
});
