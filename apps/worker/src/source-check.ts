import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Fetched pages are untrusted data: we only extract text and compare passages. */
const MAX_BYTES = 5 * 1024 * 1024;

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith('::ffff:127.') || ip === '::';
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** SSRF guard: https only, no credentials in the URL, no local or private-network targets. */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`refusing non-https source URL: ${url.protocol}`);
  if (url.username || url.password) throw new Error('refusing URL with credentials');
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.invalid')) throw new Error(`refusing host ${host}`);
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) if (isPrivateAddress(address)) throw new Error(`refusing ${host}: resolves to a private address`);
  return url;
}

/**
 * Sources are quoted in US English, so ask for English explicitly: without a
 * language preference some documentation sites serve a translated page.
 */
export async function fetchPageText(raw: string, fetchFn: typeof fetch = fetch, lang = 'en'): Promise<{ text: string; sha256: string; finalUrl: string }> {
  const url = await assertSafePublicUrl(raw);
  if (!url.searchParams.has('hl')) url.searchParams.set('hl', lang);
  const res = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000), headers: { accept: 'text/html', 'accept-language': `${lang}-US,${lang};q=0.9` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.host}${url.pathname}`);
  await assertSafePublicUrl(res.url || url.toString());
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`page larger than ${MAX_BYTES} bytes`);
  return { text: htmlToText(buf.toString('utf8')), sha256: createHash('sha256').update(buf).digest('hex'), finalUrl: res.url || url.toString() };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    // Inline tags join words (no space); everything else separates blocks.
    .replace(/<\/?(?:a|b|i|em|strong|code|span|sup|sub|abbr|var|kbd|samp|mark|small|u|s)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export interface PassageCheck {
  evidenceId: string;
  claimId: string;
  found: boolean;
}

export function checkPassages(pageText: string, evidence: Array<{ id: string; claimId: string; supportingPassage: string }>): PassageCheck[] {
  const hay = normalize(pageText);
  return evidence.map((e) => ({ evidenceId: e.id, claimId: e.claimId, found: hay.includes(normalize(e.supportingPassage)) }));
}
