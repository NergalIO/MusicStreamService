import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('MSS1');
const VERSION = 1;
const FLAG_CODEC_OPUS = 1;
const FLAG_ENCRYPTED = 2;

export interface MssHeader {
  trackId: string;
  deviceBindingHash: Buffer;
  nonce: Buffer;
}

export function deriveContentKey(
  userId: string,
  deviceId: string,
  trackId: string,
  serverSecret: string,
): Buffer {
  const salt = createHmac('sha256', serverSecret).update('mss-offline-v1').digest();
  return Buffer.from(
    hkdfSync('sha256', `${userId}:${deviceId}:${trackId}`, salt, 'mss-content-key', 32),
  );
}

export function computeDeviceBindingHash(deviceId: string, serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update(deviceId).digest().subarray(0, 16);
}

export function encodeMssPackage(
  trackId: string,
  deviceId: string,
  payload: Buffer,
  contentKey: Buffer,
  serverSecret: string,
): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const deviceBindingHash = computeDeviceBindingHash(deviceId, serverSecret);
  const trackUuid = parseUuid(trackId);

  const header = Buffer.alloc(4 + 2 + 2 + 16 + 16 + 12 + 4);
  let o = 0;
  MAGIC.copy(header, o);
  o += 4;
  header.writeUInt16LE(VERSION, o);
  o += 2;
  header.writeUInt16LE(FLAG_CODEC_OPUS | FLAG_ENCRYPTED, o);
  o += 2;
  trackUuid.copy(header, o);
  o += 16;
  deviceBindingHash.copy(header, o);
  o += 16;
  nonce.copy(header, o);
  o += 12;
  header.writeUInt32LE(ciphertext.length, o);

  return Buffer.concat([header, ciphertext]);
}

export function decodeMssPackage(
  data: Buffer,
  deviceId: string,
  contentKey: Buffer,
  serverSecret: string,
): { trackId: string; payload: Buffer } {
  if (data.length < 56) throw new Error('Invalid MSS file');
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid MSS magic');
  const version = data.readUInt16LE(4);
  if (version !== VERSION) throw new Error(`Unsupported MSS version ${version}`);
  const trackId = formatUuid(data.subarray(8, 24));
  const deviceBindingHash = data.subarray(24, 40);
  const expected = computeDeviceBindingHash(deviceId, serverSecret);
  if (!deviceBindingHash.equals(expected)) {
    throw new Error('Device binding mismatch');
  }
  const nonce = data.subarray(40, 52);
  const ctLen = data.readUInt32LE(52);
  const ciphertext = data.subarray(56, 56 + ctLen);
  if (ciphertext.length < 16) throw new Error('Invalid ciphertext');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', contentKey, nonce);
  decipher.setAuthTag(authTag);
  const payload = Buffer.concat([decipher.update(enc), decipher.final()]);
  return { trackId, payload };
}

function parseUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function formatUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
