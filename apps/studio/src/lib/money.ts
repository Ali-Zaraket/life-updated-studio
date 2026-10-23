export const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

/** Parses a US-dollar string (0–10,000, at most two decimals) to integer micro-USD. Returns null when invalid. */
export function dollarsToMicroUsd(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (cents > 10_000 * 100) return null;
  return cents * 10_000;
}
