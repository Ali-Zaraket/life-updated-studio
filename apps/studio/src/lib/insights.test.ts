import { describe, expect, it } from 'vitest';
import { compare, describeValue, groupStats, latest, median, rateView, type EpisodeData, type Snap } from './insights';

let n = 0;
const snap = (metric: string, value: number | null, o: Partial<Snap> = {}): Snap => ({
  id: `s${n++}`, metric, definition: 'd', unit: 'count', window: '24h', mediaAgeSec: 86400, apiVersion: 'v1',
  retrievedAt: '2026-01-02T00:00:00Z', value, unavailabilityReason: value === null ? 'not_yet_available' : null,
  source: 'live', rawResponseId: null, ...o,
});
const ep = (code: string, pillar: string, reach: number | null, saves: number | null, o: Partial<EpisodeData> = {}): EpisodeData => ({
  code, pillar, format: 'f', source: 'live', snapshots: [snap('reach', reach), snap('saves', saves)], ...o,
});

describe('rateView', () => {
  it('renders rate with provenance', () => {
    expect(rateView(snap('saves', 27), snap('reach', 1280), 'saves').text).toBe('2.1% (27 / 1,280)');
  });
  it('null for missing sides and zero denominator, never 0', () => {
    const a = rateView(snap('saves', null), snap('reach', 100), 'saves');
    expect(a.rate.rate).toBeNull();
    expect(a.text).toMatch(/^— \(saves unavailable: not_yet_available\)/);
    expect(rateView(snap('saves', 3), snap('reach', 0), 'saves').text).toBe('— (reach is 0)');
    expect(rateView(null, snap('reach', 10), 'saves').text).toContain('not collected');
  });
  it('describeValue never renders null as 0', () => {
    expect(describeValue(snap('reach', null))).toBe('— (not_yet_available)');
    expect(describeValue(snap('reach', 0))).toBe('0');
  });
});

describe('latest', () => {
  it('picks latest per window and honours source', () => {
    const s = [snap('reach', 1, { retrievedAt: '2026-01-01T00:00:00Z' }), snap('reach', 2), snap('reach', 9, { source: 'mock' })];
    expect(latest(s, 'reach', '24h', 'live')!.value).toBe(2);
    expect(latest(s, 'reach', '72h')).toBeNull();
  });
});

describe('compare', () => {
  it('median and range', () => {
    expect(median([1, 3, 2, 10])).toBe(2.5);
    const g = groupStats('x', [1, 2, 3, 4, 5].map((i) => ({ code: `E${i}`, rate: i / 100, numerator: i, reach: 300, definitionKey: 'k', definitions: '' })));
    expect(g).toMatchObject({ n: 5, combinedReach: 1500, median: 0.03, min: 0.01, max: 0.05, sufficient: true });
  });
  it('insufficient when n<5 or reach<1000, no ranking', () => {
    const eps = [ep('A', 'p1', 500, 10), ep('B', 'p2', 500, 20)];
    const c = compare(eps, 'saves', '24h', 'pillar');
    expect(c.buckets[0]!.ranked).toBe(false);
    expect(c.buckets[0]!.verdict).toContain('Insufficient evidence');
  });
  it('ranks when every group is sufficient', () => {
    const eps = [
      ...[1, 2, 3, 4, 5].map((i) => ep(`A${i}`, 'p1', 300, 3)),
      ...[1, 2, 3, 4, 5].map((i) => ep(`B${i}`, 'p2', 300, 9)),
    ];
    const b = compare(eps, 'saves', '24h', 'pillar').buckets[0]!;
    expect(b.ranked).toBe(true);
    expect(b.groups.map((g) => g.label)).toEqual(['p2', 'p1']);
  });
  it('excludes episodes missing a side and never pools sources or definitions', () => {
    const eps = [
      ep('A', 'p', 100, null),
      ep('B', 'p', 100, 5),
      ep('C', 'p', 100, 5, { source: 'mock', snapshots: [snap('reach', 100, { source: 'mock' }), snap('saves', 5, { source: 'mock' })] }),
      ep('D', 'p', 100, 5, { snapshots: [snap('reach', 100, { apiVersion: 'v2' }), snap('saves', 5, { apiVersion: 'v2' })] }),
    ];
    const c = compare(eps, 'saves', '24h', null);
    expect(c.buckets).toHaveLength(3);
    expect(c.buckets.every((b) => b.groups[0]!.n === 1)).toBe(true);
    expect(c.definitionWarnings).toEqual(['live']);
  });
  it('ignores other windows', () => {
    const e = ep('A', 'p', 100, 5, { snapshots: [snap('reach', 100, { window: '1h' }), snap('saves', 5, { window: '1h' })] });
    expect(compare([e], 'saves', '24h', null).buckets).toHaveLength(0);
  });
});
