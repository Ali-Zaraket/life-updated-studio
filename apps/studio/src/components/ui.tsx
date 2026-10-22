import type { ReactNode } from 'react';

export function Badge({ kind = 'neutral', children }: { kind?: 'neutral' | 'good' | 'bad' | 'warn' | 'mock' | 'fixture'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export const MockBadge = () => <Badge kind="mock">MOCK</Badge>;
export const FixtureBadge = () => <Badge kind="fixture">FIXTURE</Badge>;

export function SourceBadge({ source }: { source: string }) {
  if (source === 'mock') return <MockBadge />;
  if (source === 'manual_import') return <Badge kind="warn">MANUAL IMPORT</Badge>;
  return <Badge kind="good">LIVE</Badge>;
}

export function Notice({ ok, err }: { ok?: string; err?: string }) {
  return (
    <>
      {ok ? <p className="notice ok" role="status">{ok}</p> : null}
      {err ? <p className="notice err" role="alert">{err}</p> : null}
    </>
  );
}

export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 10)}…` : '—');

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z');
}

export const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
