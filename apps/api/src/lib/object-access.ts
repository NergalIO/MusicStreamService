import crypto from 'node:crypto';
import { config } from '../config.js';

export function signObjectAccess(method: 'GET' | 'PUT', bucket: string, key: string, exp: number): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${method}:${bucket}:${key}:${exp}`).digest('hex');
}

export function verifyObjectAccess(
  method: 'GET' | 'PUT',
  bucket: string,
  key: string,
  expRaw: string | undefined,
  sig: string | undefined,
): boolean {
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = signObjectAccess(method, bucket, key, exp);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function localObjectUrl(
  method: 'GET' | 'PUT',
  bucket: string,
  key: string,
  expiresInSec: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const sig = signObjectAccess(method, bucket, key, exp);
  const q = new URLSearchParams({ bucket, key, exp: String(exp), sig });
  return `${config.publicUrl}/objects?${q.toString()}`;
}
