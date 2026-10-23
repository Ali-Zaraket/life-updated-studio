import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * Local object storage. URIs look like `storage://episodes/LU-TECH-001/delivery.mp4`
 * and always resolve inside the storage root.
 */
export class LocalStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(uri: string): string {
    if (!uri.startsWith('storage://')) throw new Error(`not a storage URI: ${uri}`);
    const rel = uri.slice('storage://'.length);
    if (rel === '' || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`unsafe storage path: ${uri}`);
    const full = resolve(this.root, rel);
    const back = relative(this.root, full);
    if (back.startsWith('..') || isAbsolute(back)) throw new Error(`storage path escapes root: ${uri}`);
    return full;
  }

  async put(localPath: string, rel: string): Promise<string> {
    const uri = `storage://${rel}`;
    const dest = this.resolve(uri);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return uri;
  }

  /**
   * The URL handed to the publisher. The mock never fetches it; a live adapter
   * will need a signed, time-limited public URL here.
   */
  mockPublicUrl(uri: string): string {
    return `https://mock-storage.invalid/${uri.slice('storage://'.length)}`;
  }
}
