import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelJob, completeJob, enqueueJob, failJob, leaseJobs, type Db } from '../src/index';
import { freshDb } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

const T0 = new Date('2026-10-22T10:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('lease queue', () => {
  it('dedupes by idempotency key', async () => {
    const a = await enqueueJob(db, { id: 'j1', kind: 'k', payload: {}, idempotencyKey: 'once', runAt: T0 });
    const b = await enqueueJob(db, { id: 'j2', kind: 'k', payload: {}, idempotencyKey: 'once', runAt: T0 });
    expect(b.id).toBe(a.id);
  });

  it('gives each job to one worker and respects run_at', async () => {
    await enqueueJob(db, { id: 'j1', kind: 'k', payload: {}, runAt: T0 });
    await enqueueJob(db, { id: 'later', kind: 'k', payload: {}, runAt: at(60_000) });
    const [w1, w2] = await Promise.all([
      leaseJobs(db, { workerId: 'w1', kinds: ['k'], limit: 5, leaseMs: 30_000, now: T0 }),
      leaseJobs(db, { workerId: 'w2', kinds: ['k'], limit: 5, leaseMs: 30_000, now: T0 }),
    ]);
    expect([...w1!, ...w2!].map((j) => j.id)).toEqual(['j1']);
  });

  it('reclaims an expired lease and the old holder cannot complete it', async () => {
    await enqueueJob(db, { id: 'j1', kind: 'k', payload: {}, runAt: T0 });
    await leaseJobs(db, { workerId: 'crashed', kinds: ['k'], limit: 1, leaseMs: 1_000, now: T0 });
    expect(await leaseJobs(db, { workerId: 'w2', kinds: ['k'], limit: 1, leaseMs: 1_000, now: at(500) })).toEqual([]);
    const [reclaimed] = await leaseJobs(db, { workerId: 'w2', kinds: ['k'], limit: 1, leaseMs: 1_000, now: at(2_000) });
    expect(reclaimed!.attempts).toBe(2);
    expect(await completeJob(db, 'j1', 'crashed', at(2_100))).toBe(false);
    expect(await completeJob(db, 'j1', 'w2', at(2_100))).toBe(true);
  });

  it('retries with backoff, then fails after max attempts', async () => {
    await enqueueJob(db, { id: 'j1', kind: 'k', payload: {}, runAt: T0, maxAttempts: 2 });
    await leaseJobs(db, { workerId: 'w', kinds: ['k'], limit: 1, leaseMs: 1_000, now: T0 });
    expect(await failJob(db, { id: 'j1', workerId: 'w', error: 'boom', now: T0 })).toBe('retry');
    expect(await leaseJobs(db, { workerId: 'w', kinds: ['k'], limit: 1, leaseMs: 1_000, now: at(10_000) })).toEqual([]);
    await leaseJobs(db, { workerId: 'w', kinds: ['k'], limit: 1, leaseMs: 1_000, now: at(31_000) });
    expect(await failJob(db, { id: 'j1', workerId: 'w', error: 'boom', now: at(31_000) })).toBe('failed');
  });

  it('cancels only queued jobs', async () => {
    await enqueueJob(db, { id: 'j1', kind: 'k', payload: {}, runAt: T0 });
    expect(await cancelJob(db, 'j1', 'owner revoked', T0)).toBe(true);
    expect(await leaseJobs(db, { workerId: 'w', kinds: ['k'], limit: 1, leaseMs: 1_000, now: at(1) })).toEqual([]);
  });
});
