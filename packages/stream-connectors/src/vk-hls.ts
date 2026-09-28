import { createDecipheriv } from 'node:crypto';

export interface HlsKey {
  method: 'AES-128' | 'NONE';
  uri?: string;
  iv?: Buffer;
}

export interface HlsSegment {
  url: string;
  duration: number;
  key: HlsKey | null;
  mediaSequence: number;
}

export interface HlsPlaylist {
  mediaSequence: number;
  targetDuration: number;
  segments: HlsSegment[];
}

const ATTR = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;

function parseAttributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = line.replace(/^#EXT-X-[A-Z0-9-]+:/, '');
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) {
    out[m[1]] = m[3] ?? m[2];
  }
  return out;
}

function resolveUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

/** IV по умолчанию в HLS: номер сегмента как 16 байт big-endian. */
export function mediaSequenceIv(seq: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(seq >>> 0, 12);
  return iv;
}

function parseIv(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length > 32) return undefined;
  return Buffer.from(hex.padStart(32, '0'), 'hex');
}

export function parseM3u8(text: string, baseUrl: string): HlsPlaylist {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let mediaSequence = 0;
  let targetDuration = 0;
  let currentKey: HlsKey | null = null;
  let pendingDuration = 0;
  const segments: HlsSegment[] = [];
  let seq = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0;
      seq = mediaSequence;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line);
      const method = attrs.METHOD === 'AES-128' ? 'AES-128' : 'NONE';
      currentKey =
        method === 'NONE'
          ? null
          : { method, uri: attrs.URI ? resolveUrl(attrs.URI, baseUrl) : undefined, iv: parseIv(attrs.IV) };
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice(8).split(',')[0]) || 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    const key = currentKey
      ? { ...currentKey, iv: currentKey.iv ?? mediaSequenceIv(seq) }
      : null;
    segments.push({
      url: resolveUrl(line, baseUrl),
      duration: pendingDuration,
      key,
      mediaSequence: seq,
    });
    seq += 1;
    pendingDuration = 0;
  }

  return { mediaSequence, targetDuration, segments };
}

export function decryptAes128Cbc(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const k = key.length === 16 ? key : key.subarray(0, 16);
  const decipher = createDecipheriv('aes-128-cbc', k, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function isMpegTs(data: Buffer): boolean {
  return data.length >= 188 && data[0] === 0x47;
}

export function looksLikeMp3(data: Buffer): boolean {
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return true;
  return data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
}

function sectionBytes(payload: Buffer, pusi: boolean): Buffer {
  if (!pusi || payload.length === 0) return payload;
  const pointer = payload[0];
  return payload.subarray(1 + pointer);
}

function parsePat(payload: Buffer, pusi: boolean): number | null {
  const section = sectionBytes(payload, pusi);
  if (section.length < 8 || section[0] !== 0x00) return null;
  const length = ((section[1] & 0x0f) << 8) | section[2];
  const end = Math.min(section.length, 3 + length);
  for (let i = 8; i + 4 <= end - 4; i += 4) {
    const program = (section[i] << 8) | section[i + 1];
    const pid = ((section[i + 2] & 0x1f) << 8) | section[i + 3];
    if (program !== 0) return pid;
  }
  return null;
}

const AUDIO_STREAM_TYPES = new Set([0x03, 0x04, 0x0f, 0x11, 0x81, 0x06]);

function parsePmt(payload: Buffer, pusi: boolean): number | null {
  const section = sectionBytes(payload, pusi);
  if (section.length < 12 || section[0] !== 0x02) return null;
  const length = ((section[1] & 0x0f) << 8) | section[2];
  const end = Math.min(section.length, 3 + length);
  const programInfo = ((section[10] & 0x0f) << 8) | section[11];
  let i = 12 + programInfo;
  let fallback: number | null = null;
  while (i + 5 <= end - 4) {
    const streamType = section[i];
    const pid = ((section[i + 1] & 0x1f) << 8) | section[i + 2];
    const esInfo = ((section[i + 3] & 0x0f) << 8) | section[i + 4];
    if (AUDIO_STREAM_TYPES.has(streamType)) return pid;
    fallback ??= pid;
    i += 5 + esInfo;
  }
  return fallback;
}

function extractPesPayload(pes: Buffer): Buffer {
  if (pes.length < 9 || pes[0] !== 0x00 || pes[1] !== 0x00 || pes[2] !== 0x01) return pes;
  const packetLength = (pes[4] << 8) | pes[5];
  const start = 9 + pes[8];
  if (packetLength > 0) {
    const end = Math.min(pes.length, 6 + packetLength);
    return start < end ? pes.subarray(start, end) : Buffer.alloc(0);
  }
  return pes.subarray(start);
}

/** MPEG-TS → сырой MP3/AAC payload. Если это уже MP3, возвращает вход как есть. */
export function demuxMpegTsAudio(data: Buffer): Buffer {
  if (!data.length) return data;
  if (looksLikeMp3(data) && !isMpegTs(data)) return data;

  let start = 0;
  while (start + 188 <= data.length && data[start] !== 0x47) start += 1;
  if (start + 188 > data.length) return looksLikeMp3(data) ? data : Buffer.alloc(0);

  let pmtPid: number | null = null;
  let audioPid: number | null = null;
  const chunks: Buffer[] = [];
  let pes: Buffer | null = null;

  for (let i = start; i + 188 <= data.length; i += 188) {
    if (data[i] !== 0x47) {
      const next = data.indexOf(0x47, i + 1);
      if (next < 0) break;
      i = next - 188;
      continue;
    }
    const pid = ((data[i + 1] & 0x1f) << 8) | data[i + 2];
    const pusi = (data[i + 1] & 0x40) !== 0;
    const adaptation = (data[i + 3] & 0x30) >> 4;
    let offset = 4;
    if (adaptation === 2 || adaptation === 3) {
      offset = 5 + data[i + 4];
    }
    if (offset >= 188) continue;
    const payload = data.subarray(i + offset, i + 188);

    if (pid === 0) {
      pmtPid = parsePat(payload, pusi) ?? pmtPid;
    } else if (pmtPid != null && pid === pmtPid) {
      audioPid = parsePmt(payload, pusi) ?? audioPid;
    } else if (audioPid != null && pid === audioPid) {
      if (pusi) {
        if (pes) chunks.push(extractPesPayload(pes));
        pes = Buffer.from(payload);
      } else if (pes) {
        pes = Buffer.concat([pes, payload]);
      }
    }
  }
  if (pes) chunks.push(extractPesPayload(pes));
  return Buffer.concat(chunks);
}

export function decodeSegment(data: Buffer, aesKey: Buffer | null, iv: Buffer | null): Buffer {
  const raw = aesKey && iv ? decryptAes128Cbc(data, aesKey, iv) : data;
  return demuxMpegTsAudio(raw);
}
