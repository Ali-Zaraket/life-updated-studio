import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeSpend, recordCost, setSpending, type Db } from '../src/index';
import { agent, freshDb, owner } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

const NOW = new Date('2026-10-22T12:00:00Z');
const usd = (n: number) => n * 1_000_000;
const live = (amount: number, at = NOW) =>
  recordCost(db, { provider: 'tts', operation: 'synthesize', units: 1, unitType: 'req', amountMicroUsd: usd(amount), estimated: false, source: 'live', now: at });

describe('spending guard', () => {
  it('refuses all paid calls until the owner sets a cap', async () => {
    expect(await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: 1, now: NOW })).toMatchObject({ ok: false, reason: 'no_cap_authorized' });
  });

  it('warns at half the cap and refuses calls that would cross it', async () => {
    await setSpending(db, { capMicroUsd: usd(100), actor: owner });
    await live(49);
    expect(await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: usd(0.5), now: NOW })).toMatchObject({ ok: true, warning: null });
    expect((await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: usd(2), now: NOW })) as { warning: string }).toMatchObject({ ok: true, warning: expect.stringMatching(/\$50\.00 warning/) });
    await live(50);
    expect(await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: usd(2), now: NOW })).toMatchObject({ ok: false, reason: 'would_exceed_cap' });
  });

  it('counts only live spend in the current month', async () => {
    await setSpending(db, { capMicroUsd: usd(10), actor: owner });
    await live(9, new Date('2026-09-30T23:59:00Z'));
    await recordCost(db, { provider: 'mock-tts', operation: 'x', units: 1, unitType: 'req', amountMicroUsd: usd(50), estimated: false, source: 'mock', now: NOW });
    expect(await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: usd(9), now: NOW })).toMatchObject({ ok: true });
  });

  it('the spending stop wins over the cap', async () => {
    await setSpending(db, { capMicroUsd: usd(100), actor: owner });
    await setSpending(db, { stopped: true, actor: agent });
    expect(await authorizeSpend(db, { provider: 'tts', operation: 'x', estimatedMicroUsd: 1, now: NOW })).toMatchObject({ ok: false, reason: 'spending_stopped' });
  });
});
