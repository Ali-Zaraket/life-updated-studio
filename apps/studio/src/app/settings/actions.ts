'use server';

import { setPublishingPaused, setSpending } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { done, fail, UserError } from '@/lib/flash';
import { dollarsToMicroUsd } from '@/lib/money';

export async function pauseAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    const reason = String(fd.get('reason') ?? '').trim();
    if (reason.length < 3) throw new UserError('A reason is required to pause publishing');
    await setPublishingPaused(await getDb(), { paused: true, reason, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail('/settings', e);
  }
  done('/settings', 'Publishing paused.');
}

export async function resumeAction(): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    await setPublishingPaused(await getDb(), { paused: false, reason: null, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail('/settings', e);
  }
  done('/settings', 'Publishing resumed.');
}

export async function spendingStopAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    const stopped = fd.get('stopped') === 'true';
    await setSpending(await getDb(), { stopped, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail('/settings', e);
  }
  done('/settings', 'Spending setting updated.');
}

export async function setCapAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    const micro = dollarsToMicroUsd(String(fd.get('capUsd') ?? ''));
    if (micro === null) throw new UserError('Enter a cap between 0 and 10,000 US dollars with at most two decimals.');
    await setSpending(await getDb(), { capMicroUsd: micro, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail('/settings', e);
  }
  done('/settings', 'Monthly spending cap saved.');
}

export async function removeCapAction(): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    await setSpending(await getDb(), { capMicroUsd: null, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail('/settings', e);
  }
  done('/settings', 'Cap removed. Paid generation is disabled.');
}
