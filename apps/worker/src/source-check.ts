import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Fetched pages are untrusted data: we only extract text and compare passages. */
const MAX_BYTES = 5 * 1024 * 1024;

const MAX_REDIRECTS = 5;

function ipv4Private(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (!ip.includes(':')) return ipv4Private(ip);
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped/compatible forms (::ffff:10.0.0.1, ::ffff:a00:1) carry an IPv4 target.
  const dotted = v6.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return ipv4Private(dotted[1]!);
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
    return ipv4Private([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff') || v6.startsWith('64:ff9b:');
}

/**
 * SSRF guard: https only, no credentials in the URL, no local or private-network targets.
 * Residual risk: the address is checked at lookup time, so a host that re-resolves to a
 * private address between this check and the request (DNS rebinding) is not caught here.
 * Only owner-listed source URLs reach this code, and every redirect hop is re-checked.
 */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`refusing non-https source URL: ${url.protocol}`);
  if (url.username || url.password) throw new Error('refusing URL with credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.invalid')) throw new Error(`refusing host ${host}`);
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) if (isPrivateAddress(address)) throw new Error(`refusing ${host}: resolves to a private address`);
  return url;
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error(`page larger than ${MAX_BYTES} bytes`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`page larger than ${MAX_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Sources are quoted in US English, so ask for English explicitly: without a
 * language preference some documentation sites serve a translated page.
 * Redirects are followed by hand so every hop passes the SSRF guard.
 */
export async function fetchPageText(raw: string, fetchFn: typeof fetch = fetch, lang = 'en'): Promise<{ text: string; sha256: string; finalUrl: string }> {
  let url = await assertSafePublicUrl(raw);
  if (!url.searchParams.has('hl')) url.searchParams.set('hl', lang);
  const signal = AbortSignal.timeout(30_000);
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(url, { redirect: 'manual', signal, headers: { accept: 'text/html', 'accept-language': `${lang}-US,${lang};q=0.9` } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`HTTP ${res.status} without a location for ${url.host}${url.pathname}`);
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects from ${raw}`);
      await res.body?.cancel();
      url = await assertSafePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.host}${url.pathname}`);
    const buf = await readCapped(res);
    return { text: htmlToText(buf.toString('utf8')), sha256: createHash('sha256').update(buf).digest('hex'), finalUrl: url.toString() };
  }
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
