import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string) {
  if (password.length < 10) throw new Error('Password must contain at least 10 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, keyLength) as Buffer;
  return { hash: hash.toString('hex'), salt };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = await scrypt(password, salt, keyLength) as Buffer;
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
