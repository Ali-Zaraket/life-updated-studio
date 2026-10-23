import { describe, expect, it } from 'vitest';
import { PUBLISH_STATES, needsAttention, stateFilter } from './jobs-view';

describe('jobs view', () => {
  it('highlights the three attention states', () => {
    for (const s of ['needs_reconciliation', 'failed', 'retry_wait']) expect(needsAttention(s)).toBe(true);
    expect(needsAttention('published')).toBe(false);
  });
  it('only passes known filters', () => {
    expect(stateFilter('failed', PUBLISH_STATES)).toBe('failed');
    expect(stateFilter("x' or 1=1", PUBLISH_STATES)).toBeNull();
    expect(stateFilter(undefined, PUBLISH_STATES)).toBeNull();
  });
});
