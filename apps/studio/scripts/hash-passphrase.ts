// Usage: pnpm --filter @life/studio hash-passphrase   (reads the passphrase from stdin, no echo on a TTY)
// Prints the line to paste into .env.local.
import { hashPassphrase } from '../src/lib/passphrase';

async function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\u0003') {
          stdin.setRawMode(false);
          reject(new Error('aborted'));
          return;
        }
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(buf);
          return;
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

const pass = await readHidden('Passphrase (input hidden): ');
if (pass.length < 12) {
  console.error('Refusing: passphrase must be at least 12 characters.');
  process.exit(1);
}
// Printed as the whole .env.local line, single-quoted: the hash contains `$`, which Docker Compose
// would otherwise treat as a variable. Node's env-file parser reads single quotes literally too.
console.log(`STUDIO_PASSPHRASE_HASH='${hashPassphrase(pass)}'`);
