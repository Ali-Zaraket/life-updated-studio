import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { when } from '@/components/ui';

export const dynamic = 'force-dynamic';

function actorLabel(a: unknown): string {
  const x = a as { kind?: string; ownerId?: string; agentName?: string; component?: string } | null;
  if (!x) return '—';
  return x.kind === 'owner' ? `owner:${x.ownerId}` : x.kind === 'agent' ? `agent:${x.agentName}` : `system:${x.component}`;
}

export default async function AuditPage() {
  await requireOwner();
  const rows = await (await getDb()).query.auditEvents.findMany({ orderBy: (a, { desc }) => desc(a.at), limit: 200 });
  return (
    <main>
      <h1>Audit log <span className="muted">(latest 200)</span></h1>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{when(r.at)}</td>
                <td>{actorLabel(r.actor)}</td>
                <td>{r.action}</td>
                <td className="mono">{r.entityType}:{r.entityId}</td>
                <td className="mono">{JSON.stringify(r.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
