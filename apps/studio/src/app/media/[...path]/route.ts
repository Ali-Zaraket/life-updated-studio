import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { currentOwner } from '@/lib/auth';
import { resolveInStorage } from '@/lib/media';

export const dynamic = 'force-dynamic';

const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" };

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (!(await currentOwner())) return new Response('Unauthorized', { status: 401, headers: HEADERS });
  const { path } = await ctx.params;
  const found = await resolveInStorage(path.map((s) => decodeURIComponent(s)));
  if (!found) return new Response('Not found', { status: 404, headers: HEADERS });

  const base = { ...HEADERS, 'Content-Type': found.contentType, 'Accept-Ranges': 'bytes' };
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m && m[1] ? Number(m[1]) : NaN;
    let end = m && m[2] ? Number(m[2]) : NaN;
    if (!m || (Number.isNaN(start) && Number.isNaN(end))) return new Response('Bad range', { status: 416, headers: { ...base, 'Content-Range': `bytes */${found.size}` } });
    if (Number.isNaN(start)) {
      start = Math.max(0, found.size - end);
      end = found.size - 1;
    } else if (Number.isNaN(end) || end >= found.size) end = found.size - 1;
    if (start > end || start >= found.size) return new Response('Bad range', { status: 416, headers: { ...base, 'Content-Range': `bytes */${found.size}` } });
    const body = Readable.toWeb(createReadStream(found.file, { start, end })) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${found.size}`, 'Content-Length': String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(found.file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(found.size) } });
}
