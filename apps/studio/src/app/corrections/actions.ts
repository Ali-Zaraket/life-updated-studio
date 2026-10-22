'use server';

import { planCorrection } from '@life/content';
import { flagCorrection, resolveCorrection, DomainError } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { done, fail, UserError } from '@/lib/flash';
import { parsePreviewTime, parseTrigger } from '@/lib/corrections';
import { redirect } from 'next/navigation';

const planner = planCorrection as never;

export async function flagAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  const kind = String(fd.get('kind') ?? '');
  const id = String(fd.get('id') ?? '');
  const back = `/corrections/new?kind=${encodeURIComponent(kind)}&${kind === 'source' ? 'sourceId' : kind === 'origin' ? 'originId' : 'claimId'}=${encodeURIComponent(id)}`;
  let correctionId: string;
  try {
    const t = parseTrigger(kind, id);
    if (!t.ok) throw new UserError(t.reason);
    const expected = String(fd.get('planSha256') ?? '');
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new UserError('Preview first; the plan hash is missing.');
    const at = parsePreviewTime(fd.get('generatedAt'), new Date());
    if (!at.ok) throw new UserError(at.reason);
    // Previews older than the window must be redone; the hash itself ignores the time, so the click time is recorded.
    ({ correctionId } = await flagCorrection(await getDb(), { trigger: t.trigger, planner, expectedPlanSha256: expected, actor: { kind: 'owner', ownerId } }));
  } catch (e) {
    if (e instanceof DomainError && e.code === 'plan_changed') fail(back, new UserError('The data changed since you previewed. Nothing was run. Review the new plan below.'));
    fail(back, e);
  }
  done(`/corrections/${correctionId}`, 'Automatic steps ran. Review the plan and resolve when finished.');
}

export async function resolveAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  const id = String(fd.get('id') ?? '');
  const path = `/corrections/${encodeURIComponent(id)}`;
  try {
    const status = fd.get('status');
    if (status !== 'resolved' && status !== 'dismissed') throw new UserError('Choose resolved or dismissed.');
    const resolution = String(fd.get('resolution') ?? '').trim();
    if (!resolution) throw new UserError('A resolution note is required.');
    await resolveCorrection(await getDb(), { correctionId: id, status, resolution, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail(path, e);
  }
  redirect(`${path}?ok=${encodeURIComponent('Correction closed.')}`);
}
