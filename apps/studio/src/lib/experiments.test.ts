import { describe, expect, it } from 'vitest';
import { checkDecision, composeChange } from './experiments';

const base = { result: 'improved', decision: 'promote', rollback: 'revert to template A', evidenceSummary: '' };
describe('checkDecision', () => {
  it('refuses promote without typed evidence', () => {
    expect(checkDecision(base).ok).toBe(false);
    expect(checkDecision({ ...base, evidenceSummary: 'short' }).ok).toBe(false);
  });
  it('accepts promote with evidence', () => {
    const r = checkDecision({ ...base, evidenceSummary: '6 vs 6 posts, 1,200 reached each, no topic confound' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.startsWith('improved: ')).toBe(true);
  });
  it('refuses promote on insufficient evidence', () => {
    expect(checkDecision({ ...base, result: 'insufficient_evidence', evidenceSummary: 'x'.repeat(30) }).ok).toBe(false);
  });
  it('allows insufficient evidence with continue_collecting', () => {
    expect(checkDecision({ result: 'insufficient_evidence', decision: 'continue_collecting', rollback: 'none needed', evidenceSummary: '' }).ok).toBe(true);
  });
  it('requires rollback and valid enums', () => {
    expect(checkDecision({ ...base, decision: 'keep_baseline', rollback: ' ' }).ok).toBe(false);
    expect(checkDecision({ ...base, result: 'bogus' }).ok).toBe(false);
  });
});
describe('composeChange', () => {
  it('joins variable and baseline', () => expect(composeChange(' hook ', ' T1 ')).toContain('hook\nBaseline template: T1'));
});
