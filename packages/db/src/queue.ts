import { and, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { jobs } from './schema';

export type JobRow = typeof jobs.$inferSelect;

export interface EnqueueInput {
  id: string;
  kind: string;
  payload: unknown;
  runAt?: Date;
  maxAttempts?: number;
  /** A second enqueue with the same key is a no-op that returns the existing job. */
  idempotencyKey?: string;
}

export async function enqueueJob(db: Db, input: EnqueueInput): Promise<JobRow> {
  const [row] = await db
    .insert(jobs)
    .values({
      id: input.id,
      kind: input.kind,
      payload: input.payload,
      runAt: (input.runAt ?? new Date()).toISOString(),
      maxAttempts: input.maxAttempts ?? 5,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey!));
  return existing!;
}

export interface LeaseInput {
  workerId: string;
  kinds: readonly string[];
  limit: number;
  leaseMs: number;
  now: Date;
}

/**
 * Claims ready jobs with FOR UPDATE SKIP LOCKED so concurrent workers never
 * receive the same job. Jobs whose lease expired are reclaimed; ones that have
 * used all attempts are failed instead.
 */
export async function leaseJobs(db: Db, input: LeaseInput): Promise<JobRow[]> {
  const now = input.now.toISOString();
  const leaseUntil = new Date(input.now.getTime() + input.leaseMs).toISOString();
  return db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({ state: 'failed', lastError: 'lease expired after final attempt', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(jobs.state, 'leased'), lt(jobs.leaseExpiresAt, now), sql`${jobs.attempts} >= ${jobs.maxAttempts}`));

    const ready = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          inArray(jobs.kind, [...input.kinds]),
          or(and(eq(jobs.state, 'queued'), lte(jobs.runAt, now)), and(eq(jobs.state, 'leased'), lt(jobs.leaseExpiresAt, now))),
        ),
      )
      .orderBy(jobs.runAt)
      .limit(input.limit)
      .for('update', { skipLocked: true });
    if (ready.length === 0) return [];

    return tx
      .update(jobs)
      .set({
        state: 'leased',
        leaseOwner: input.workerId,
        leaseExpiresAt: leaseUntil,
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(inArray(jobs.id, ready.map((r) => r.id)))
      .returning();
  });
}

function ownedLease(id: string, workerId: string) {
  return and(eq(jobs.id, id), eq(jobs.state, 'leased'), eq(jobs.leaseOwner, workerId));
}

/** Returns false if the lease was lost (expired and reclaimed); the caller must stop. */
export async function completeJob(db: Db, id: string, workerId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ state: 'succeeded', leaseOwner: null, leaseExpiresAt: null, updatedAt: now.toISOString() })
    .where(ownedLease(id, workerId))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

export async function extendLease(db: Db, id: string, workerId: string, leaseMs: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: now.toISOString() })
    .where(ownedLease(id, workerId))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

export function backoffMs(attempt: number, baseMs = 30_000, capMs = 30 * 60_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export interface FailInput {
  id: string;
  workerId: string;
  error: string;
  now: Date;
  /** Never retry (e.g. gate rejection). */
  permanent?: boolean;
  /** Overrides backoff, e.g. a provider's Retry-After. */
  retryAfterMs?: number;
}

export async function failJob(db: Db, input: FailInput): Promise<'retry' | 'failed' | 'lease_lost'> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(jobs).where(ownedLease(input.id, input.workerId)).for('update');
    if (!row) return 'lease_lost';
    const exhausted = input.permanent || row.attempts >= row.maxAttempts;
    const delay = input.retryAfterMs ?? backoffMs(row.attempts);
    await tx
      .update(jobs)
      .set({
        state: exhausted ? 'failed' : 'queued',
        runAt: exhausted ? row.runAt : new Date(input.now.getTime() + delay).toISOString(),
        lastError: input.error.slice(0, 2000),
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now.toISOString(),
      })
      .where(eq(jobs.id, input.id));
    return exhausted ? 'failed' : 'retry';
  });
}

export async function cancelJob(db: Db, id: string, reason: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ state: 'cancelled', lastError: reason, leaseOwner: null, leaseExpiresAt: null, updatedAt: now.toISOString() })
    .where(and(eq(jobs.id, id), eq(jobs.state, 'queued')))
    .returning({ id: jobs.id });
  return rows.length === 1;
}
