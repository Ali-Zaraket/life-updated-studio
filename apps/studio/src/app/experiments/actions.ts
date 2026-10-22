'use server';

import { randomUUID } from 'node:crypto';
import { audit, and, eq, isNull, tables as t } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { done, fail, UserError } from '@/lib/flash';
import { checkDecision, composeChange } from '@/lib/experiments';

const PATH = '/experiments';
const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function createExperimentAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    const hypothesis = text(fd, 'hypothesis');
    const variable = text(fd, 'variable');
    const window = text(fd, 'window');
    const baseline = text(fd, 'baseline');
    if (hypothesis.length < 10) throw new UserError('Write the hypothesis.');
    if (!variable || /\band\b|;|\n/i.test(variable)) throw new UserError('Change exactly one variable; describe it in one short phrase without "and".');
    if (!window) throw new UserError('An evaluation window is required.');
    if (!baseline) throw new UserError('A baseline template is required.');
    const db = await getDb();
    const id = `exp_${randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.insert(t.experiments).values({ id, hypothesis, change: composeChange(variable, baseline), evaluationWindow: window });
      await audit(tx, { actor: { kind: 'owner', ownerId }, action: 'experiment.created', entityType: 'experiment', entityId: id, details: { variable, window } });
    });
  } catch (e) {
    fail(PATH, e);
  }
  done(PATH, 'Experiment recorded. Organic comparisons are observational, not causal tests.');
}

export async function recordDecisionAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    const id = text(fd, 'id');
    const c = checkDecision({ result: text(fd, 'result'), decision: text(fd, 'decision'), rollback: text(fd, 'rollback'), evidenceSummary: text(fd, 'evidence') });
    if (!c.ok) throw new UserError(c.reason);
    const db = await getDb();
    await db.transaction(async (tx) => {
      // Recorded once; a revised judgment is a new experiment version.
      const rows = await tx.update(t.experiments).set({ result: c.result, decision: c.decision, rollback: c.rollback }).where(and(eq(t.experiments.id, id), isNull(t.experiments.decision))).returning({ id: t.experiments.id });
      if (rows.length !== 1) throw new UserError('This experiment already has a decision or does not exist.');
      await audit(tx, { actor: { kind: 'owner', ownerId }, action: 'experiment.decided', entityType: 'experiment', entityId: id, details: { decision: c.decision, result: c.result } });
    });
  } catch (e) {
    fail(PATH, e);
  }
  done(PATH, 'Decision recorded.');
}
