import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
/** Random secret handed to the uploader; only its SHA-256 hash is stored. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
