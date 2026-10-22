'use server';

import { approveVoiceProfile, saveVoiceProfile } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { done, fail, UserError } from '@/lib/flash';
import { hashClipFile, loadClip } from '@/lib/voice';

export async function chooseNarratorAction(fd: FormData): Promise<void> {
  const { ownerId } = await requireOwner();
  try {
    if (fd.get('confirm') !== 'yes') throw new UserError('Confirm the narrator choice first.');
    const index = Number(fd.get('index'));
    const clip = Number.isInteger(index) ? await loadClip(String(fd.get('manifest') ?? ''), index) : null;
    if (!clip) throw new UserError('That audition clip is no longer in its manifest.');
    const actual = await hashClipFile(clip.fileRel);
    if (!actual) throw new UserError('The audition clip file is missing or unreadable.');
    if (actual !== clip.sha256) throw new UserError('The clip file does not match the sha256 in its manifest. Re-run the audition; nothing was approved.');
    if (clip.mock) throw new UserError('This clip is marked mock; a mock voice cannot be approved as the narrator.');

    const db = await getDb();
    const actor = { kind: 'owner', ownerId } as const;
    const id = `${clip.provider}:${clip.voiceId}`;
    const existing = await db.query.voiceProfiles.findMany({ where: (v, { eq }) => eq(v.id, id) });
    let version = existing.reduce((m, v) => Math.max(m, v.version), 0);
    if (version === 0) {
      version = 1;
      await saveVoiceProfile(db, {
        id,
        version,
        actor,
        profile: { provider: clip.provider, voiceId: clip.voiceId, voiceLabel: clip.voiceLabel, locale: 'en-US', source: 'audition', manifest: clip.manifestRel, clip: clip.fileRel },
      });
    }
    await approveVoiceProfile(db, { id, version, referenceClipSha256: actual, actor });
  } catch (e) {
    fail('/voice', e);
  }
  done('/voice', 'Narrator approved.');
}
