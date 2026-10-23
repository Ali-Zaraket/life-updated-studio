'use server';

import { revokeApproval, rejectRelease, getApproval, getEpisode, getEpisodeVersion, getReleasePackage, latestReleasePackage } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { signAndRecordApproval } from '@/lib/approval';
import { evaluateGatesFor } from '@/lib/gates';
import { done, fail, UserError } from '@/lib/flash';

const MAX_WINDOW_DAYS = 30;

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
}

function parseUtc(label: string, v: string): Date {
  // Require an explicit zone designator so the owner's intent is never guessed.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    throw new UserError(`${label} must be ISO 8601 with a zone, e.g. 2026-10-23T09:00:00Z`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new UserError(`${label} is not a valid date`);
  return d;
}

export async function approveAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  const code = str(fd, 'code');
  const path = `/episodes/${encodeURIComponent(code)}`;
  try {
    const db = await getDb();
    const packageId = str(fd, 'packageId');
    const now = new Date();
    const notBefore = parseUtc('Window start', str(fd, 'notBefore'));
    const notAfter = parseUtc('Window end', str(fd, 'notAfter'));
    const expiresAt = parseUtc('Approval expiry', str(fd, 'expiresAt'));
    if (notAfter <= notBefore) throw new UserError('Window end must be after window start');
    if (notAfter <= now) throw new UserError('Window end is already in the past');
    if (notAfter.getTime() - now.getTime() > MAX_WINDOW_DAYS * 86_400_000) throw new UserError(`Window may not extend beyond ${MAX_WINDOW_DAYS} days from now`);
    if (expiresAt <= now) throw new UserError('Approval expiry must be in the future');
    if (expiresAt > notAfter) throw new UserError('Approval expiry may not be later than the window end');

    const ep = await db.query.episodes.findFirst({ where: (e, { eq }) => eq(e.code, code) });
    if (!ep) throw new UserError('Episode not found');
    if (ep.state !== 'awaiting_user_approval') throw new UserError(`Episode is ${ep.state}, not awaiting approval`);
    if (!ep.currentVersionId) throw new UserError('Episode has no current version');
    const pkg = await getReleasePackage(db, packageId);
    const latest = await latestReleasePackage(db, ep.id);
    if (pkg.episodeId !== ep.id || latest?.id !== pkg.id) throw new UserError('This is not the latest release package; reload the page');
    if (pkg.episodeVersionId !== ep.currentVersionId) throw new UserError('Release package is for an older version');

    const version = await getEpisodeVersion(db, ep.currentVersionId);
    const gates = await evaluateGatesFor(db, ep.id, version, now);
    if (!gates.evidence.ok) throw new UserError('The evidence gate is failing; approval refused');
    if (!gates.creative.ok) throw new UserError('The creative rules gate is failing; approval refused');

    await signAndRecordApproval(db, { pkg, ownerId, choice: { notBefore, notAfter, expiresAt }, now });
  } catch (e) {
    fail(path, e);
  }
  done(path, 'Approved. The signed approval was recorded.');
}

export async function rejectAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  const code = str(fd, 'code');
  const path = `/episodes/${encodeURIComponent(code)}`;
  try {
    const feedback = str(fd, 'feedback');
    if (feedback.length < 3) throw new UserError('Feedback is required to reject');
    const db = await getDb();
    const pkg = await getReleasePackage(db, str(fd, 'packageId'));
    const ep = await getEpisode(db, pkg.episodeId);
    if (ep.code !== code) throw new UserError('Package does not belong to this episode');
    if (ep.state !== 'awaiting_user_approval') throw new UserError(`Episode is ${ep.state}, not awaiting approval`);
    await rejectRelease(db, { releasePackageId: pkg.id, ownerId, feedback });
  } catch (e) {
    fail(path, e);
  }
  done(path, 'Rejected with feedback; the episode returned to scripted.');
}

export async function revokeAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  const code = str(fd, 'code');
  const path = `/episodes/${encodeURIComponent(code)}`;
  try {
    const reason = str(fd, 'reason');
    if (reason.length < 3) throw new UserError('A reason is required to revoke');
    const db = await getDb();
    const approvalId = str(fd, 'approvalId');
    const approval = await getApproval(db, approvalId);
    const apkg = await getReleasePackage(db, approval.releasePackageId);
    const aep = await getEpisode(db, apkg.episodeId);
    if (aep.code !== code) throw new UserError('Approval does not belong to this episode');
    await revokeApproval(db, { approvalId, reason, actor: { kind: 'owner', ownerId } });
  } catch (e) {
    fail(path, e);
  }
  done(path, 'Approval revoked.');
}
