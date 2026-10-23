// Usage: pnpm --filter @life/studio approval-key
// Writes secrets/approval-ed25519.pem (0600) and secrets/public/approval-public-keys.json. Refuses to overwrite.
// The public file sits in its own folder so the worker can be given that folder and nothing else.
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function root(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}

const secrets = join(root(), 'secrets');
const pemPath = join(secrets, 'approval-ed25519.pem');
const pubPath = join(secrets, 'public', 'approval-public-keys.json');
if (existsSync(pemPath) || existsSync(pubPath)) {
  console.error('Refusing to overwrite existing key material in secrets/. Move it away deliberately first.');
  process.exit(1);
}
mkdirSync(secrets, { recursive: true, mode: 0o700 });
mkdirSync(dirname(pubPath), { recursive: true });

const keyId = process.env.STUDIO_APPROVAL_KEY_ID || 'studio-local-1';
const { privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();

writeFileSync(pemPath, privatePem, { mode: 0o600, flag: 'wx' });
chmodSync(pemPath, 0o600);
writeFileSync(pubPath, JSON.stringify({ [keyId]: publicPem }, null, 2) + '\n', { mode: 0o644, flag: 'wx' });

console.log(`Key id: ${keyId}`);
console.log(`Private key written to ${pemPath} (0600). Never commit or share it.`);
console.log(`Public keys written to ${pubPath}.`);
console.log('Set STUDIO_APPROVAL_KEY_ID in .env.local if you changed it from studio-local-1.');
console.log('Session secret suggestion (not stored): ' + randomBytes(32).toString('base64'));
