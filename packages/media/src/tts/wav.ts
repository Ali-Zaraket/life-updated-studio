/** Minimal WAV helpers for the live TTS providers (mono 16-bit PCM only). */

export function buildWavFromPcm16(pcm: Buffer, sampleRateHz: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2 * channels, 28);
  header.writeUInt16LE(2 * channels, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface ParsedWav {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  pcm: Buffer;
}

/** Parses a RIFF/WAVE PCM file. Tolerates streaming headers (data size 0 or 0xFFFFFFFF). Throws on anything else. */
export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let fmt: { audioFormat: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) throw new Error('truncated fmt chunk');
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      if (fmt.audioFormat !== 1) throw new Error(`unsupported WAV encoding ${fmt.audioFormat} (need PCM)`);
      const remaining = buf.length - body;
      const len = size === 0 || size === 0xffffffff || size > remaining ? remaining : size;
      return { sampleRateHz: fmt.rate, channels: fmt.channels, bitsPerSample: fmt.bits, pcm: buf.subarray(body, body + len) };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
