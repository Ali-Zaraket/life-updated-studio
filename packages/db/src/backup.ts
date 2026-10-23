import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { hashCanonical } from '@life/contracts';
import { migrationsFolder, type Db } from './client';
import { DomainError, revokeApprovalInTx } from './repo';
import * as t from './schema';

/**
 * Portable logical backup: every table as JSON rows, in foreign-key order,
 * with a sha256 per table. Independent of pg_dump versions, so it works the
 * same on Windows, Linux and PGlite. Restores only into an empty, migrated
 * database. One-time OAuth states are deliberately not backed up.
 */
const ORDER = [
  ['owners', t.owners],
  ['topics', t.topics],
  ['sources', t.sources],
  ['claims', t.claims],
  ['claim_evidence', t.claimEvidence],
  ['review_records', t.reviewRecords],
  ['episodes', t.episodes],
  ['episode_versions', t.episodeVersions],
  ['episode_transitions', t.episodeTransitions],
  ['episode_links', t.episodeLinks],
  ['voice_profiles', t.voiceProfiles],
  ['licenses', t.licenses],
  ['assets', t.assets],
  ['renders', t.renders],
  ['release_packages', t.releasePackages],
  ['approvals', t.approvals],
  ['approval_rejections', t.rejections],
  ['publish_jobs', t.publishJobs],
  ['instagram_media', t.instagramMedia],
  ['metric_raw_responses', t.metricRawResponses],
  ['metric_snapshots', t.metricSnapshots],
  ['experiments', t.experiments],
  ['cost_events', t.costEvents],
  ['audit_events', t.auditEvents],
  ['jobs', t.jobs],
  ['corrections', t.corrections],
  ['instagram_credentials', t.instagramCredentials],
  ['settings', t.settings],
] as const;

export interface Backup {
  format: 'life-backup-v1';
  createdAt: string;
  migrations: string[];
  tables: Record<string, unknown[]>;
  tableSha256: Record<string, string>;
}

function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  return journal.entries.map((e) => e.tag);
}

export async function exportBackup(db: Db, now = new Date()): Promise<Backup> {
  return db.transaction(async (tx) => {
    // One consistent snapshot of every table.
    await tx.execute(sql`set transaction isolation level repeatable read`).catch(() => {});
    const tables: Record<string, unknown[]> = {};
    const tableSha256: Record<string, string> = {};
    for (const [name, table] of ORDER) {
      const rows = await tx.select().from(table as never);
      tables[name] = rows;
      tableSha256[name] = hashCanonical(rows);
    }
    return { format: 'life-backup-v1', createdAt: now.toISOString(), migrations: migrationTags(), tables, tableSha256 };
  });
}

export function verifyBackup(b: Backup): string[] {
  const problems: string[] = [];
  if (b.format !== 'life-backup-v1') problems.push(`unknown format ${String(b.format)}`);
  for (const [name] of ORDER) {
    const rows = b.tables[name];
    if (!Array.isArray(rows)) problems.push(`missing table ${name}`);
    else if (hashCanonical(rows) !== b.tableSha256[name]) problems.push(`hash mismatch in ${name}`);
  }
  return problems;
}

export async function restoreBackup(db: Db, b: Backup): Promise<Record<string, number>> {
  const problems = verifyBackup(b);
  if (problems.length) throw new DomainError('backup_invalid', problems.join('; '));
  const here = migrationTags();
  const missing = b.migrations.filter((m) => !here.includes(m));
  if (missing.length) throw new DomainError('backup_newer', `backup needs migrations this code does not have: ${missing.join(', ')}`);
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(t.episodes);
    const [{ o } = { o: 0 }] = await tx.select({ o: sql<number>`count(*)::int` }).from(t.owners);
    if (Number(n) > 0 || Number(o) > 0) throw new DomainError('target_not_empty', 'restore only into an empty database');
    const counts: Record<string, number> = {};
    for (const [name, table] of ORDER) {
      const rows = (b.tables[name] ?? []) as Record<string, unknown>[];
      counts[name] = rows.length;
      if (rows.length === 0) continue;
      if (name === 'settings') {
        // Migration already created the single settings row.
        await tx.update(t.settings).set(rows[0] as never).where(eq(t.settings.singleton, true));
        continue;
      }
      // Episodes point at versions that are inserted afterwards.
      const insertRows = name === 'episodes' ? rows.map((r) => ({ ...r, currentVersionId: null })) : rows;
      for (let i = 0; i < insertRows.length; i += 200) await tx.insert(table as never).values(insertRows.slice(i, i + 200) as never);
      if (name === 'episode_versions') {
        for (const ep of (b.tables.episodes ?? []) as { id: string; currentVersionId: string | null }[]) {
          if (ep.currentVersionId) await tx.update(t.episodes).set({ currentVersionId: ep.currentVersionId }).where(eq(t.episodes.id, ep.id));
        }
      }
    }
    // A backup can predate a revocation, so nothing restored may publish on an old approval:
    // revoke every approval (the owner approves again), and send any job that may have
    // reached Instagram through reconciliation instead of resuming it.
    const actor = { kind: 'system', component: 'db.restore' } as const;
    const now = new Date();
    const live = await tx.select({ id: t.approvals.id }).from(t.approvals).where(isNull(t.approvals.revokedAt));
    for (const { id } of live) await revokeApprovalInTx(tx, { approvalId: id, reason: 'restored from backup; approve again', actor, now });
    const inFlight = await tx
      .update(t.publishJobs)
      .set({ state: 'needs_reconciliation', stateReason: 'restored from backup mid-publish; reconcile before anything else', updatedAt: now.toISOString() })
      .where(inArray(t.publishJobs.state, ['creating_container', 'processing', 'publishing', 'confirming']))
      .returning({ id: t.publishJobs.id });
    counts.revokedApprovals = live.length;
    counts.jobsToReconcile = inFlight.length;
    return counts;
  });
}
