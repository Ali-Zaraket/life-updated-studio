/** Metric collection window for a given media age. Shared by the mock and live insights readers. */
export function windowForAge(ageSec: number): '1h' | '24h' | '72h' | '7d' {
  const HOUR = 3600;
  if (ageSec < 24 * HOUR) return '1h';
  if (ageSec < 72 * HOUR) return '24h';
  if (ageSec < 7 * 24 * HOUR) return '72h';
  return '7d';
}
