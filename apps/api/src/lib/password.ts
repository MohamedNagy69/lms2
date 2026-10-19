import { pbkdf2, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
const derive = promisify(pbkdf2);
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (encoded.startsWith('$2')) return bcrypt.compare(password, encoded);
  // Preserve access for accounts imported from Django, then rehash on login.
  const [algorithm, count, salt, hash] = encoded.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !count || !salt || !hash) return false;
  const iterations = Number(count);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, salt, iterations, 32, 'sha256');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function hashPassword(password: string) { return bcrypt.hash(password, 12); }
