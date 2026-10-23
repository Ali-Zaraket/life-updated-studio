import { describe, expect, it } from 'vitest';
import { assertSafePublicUrl, checkPassages, fetchPageText, htmlToText, isPrivateAddress } from '../src/source-check';

describe('source recheck', () => {
  it('refuses unsafe URLs before fetching', async () => {
    for (const u of ['http://example.com/', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@example.com/', 'https://fixture-source-1.invalid/x']) {
      await expect(assertSafePublicUrl(u)).rejects.toThrow();
    }
  });

  it('treats IPv4-mapped IPv6 and reserved ranges as private', () => {
    for (const ip of ['::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1', '[::1]', 'fe80::1', 'fd00::1', '198.18.0.1', '192.0.0.8', '224.0.0.1', '100.64.1.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('re-checks every redirect hop and refuses one into a private network', async () => {
    const seen: string[] = [];
    const fakeFetch = (async (input: URL | string) => {
      seen.push(String(input));
      return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } });
    }) as typeof fetch;
    await expect(fetchPageText('https://8.8.8.8/page', fakeFetch)).rejects.toThrow(/private address/);
    expect(seen).toHaveLength(1);
  });

  it('follows a safe redirect and caps the body size while streaming', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 301, headers: { location: '/moved' } });
      return new Response('<p>hello</p>', { status: 200 });
    }) as typeof fetch;
    const r = await fetchPageText('https://8.8.8.8/page', fakeFetch);
    expect(r).toMatchObject({ text: 'hello', finalUrl: 'https://8.8.8.8/moved' });

    const huge = (async () => new Response(new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); },
    }), { status: 200 })) as typeof fetch;
    await expect(fetchPageText('https://8.8.8.8/big', huge)).rejects.toThrow(/larger than/);
  });

  it('finds passages regardless of markup and whitespace, and reports missing ones', () => {
    const text = htmlToText('<html><script>ignore()</script><p>On Android 11 (API level 30) and higher,\n  however, the system dialog doesn&#39;t include</p><p>the <b>Allow all the time</b> option.</p></html>');
    const r = checkPassages(text, [
      { id: 'e1', claimId: 'c1', supportingPassage: "On Android 11 (API level 30) and higher, however, the system dialog doesn't include the Allow all the time option." },
      { id: 'e2', claimId: 'c2', supportingPassage: 'A sentence that was removed from the page.' },
    ]);
    expect(r).toEqual([{ evidenceId: 'e1', claimId: 'c1', found: true }, { evidenceId: 'e2', claimId: 'c2', found: false }]);
  });
});
