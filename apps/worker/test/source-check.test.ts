import { describe, expect, it } from 'vitest';
import { assertSafePublicUrl, checkPassages, htmlToText } from '../src/source-check';

describe('source recheck', () => {
  it('refuses unsafe URLs before fetching', async () => {
    for (const u of ['http://example.com/', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@example.com/', 'https://fixture-source-1.invalid/x']) {
      await expect(assertSafePublicUrl(u)).rejects.toThrow();
    }
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
