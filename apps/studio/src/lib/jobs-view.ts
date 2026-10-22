export const QUEUE_STATES = ['queued', 'leased', 'succeeded', 'failed', 'cancelled'] as const;
export const PUBLISH_STATES = [
  'queued', 'gate_check', 'retry_wait', 'creating_container', 'processing', 'publishing', 'confirming', 'needs_reconciliation', 'published', 'failed', 'cancelled',
] as const;
/** States the owner must look at. */
export const ATTENTION_STATES: readonly string[] = ['needs_reconciliation', 'failed', 'retry_wait'];

export const needsAttention = (state: string) => ATTENTION_STATES.includes(state);

/** Filter value from the query string, or null for "all". */
export function stateFilter(raw: unknown, allowed: readonly string[]): string | null {
  return typeof raw === 'string' && allowed.includes(raw) ? raw : null;
}
