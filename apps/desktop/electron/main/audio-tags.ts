export interface AudioTags {
  title: string;
  artist: string;
  album?: string;
  trackNumber?: number;
}

export interface CoverImage {
  data: Buffer;
  mime: string;
}

// --- MP4 → FLAC ---

interface Box {
  type: string;
  start: number;
  end: number;
}

function children(buf: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) break;
    out.push({ type: buf.toString('latin1', p + 4, p + 8), start: p + header, end: p + size });
    p += size;
  }
  return out;
}

function child(buf: Buffer, parent: Box, type: string): Box {
  const found = children(buf, parent.start, parent.end).find((b) => b.type === type);
  if (!found) throw new Error(`MP4: нет блока ${type}`);
  return found;
}

function descend(buf: Buffer, root: Box, types: string[]): Box {
  return types.reduce((box, type) => child(buf, box, type), root);
}

interface FlacParts {
  /** Флаг «последний блок» проставляется заново при сборке файла. */
  blocks: { type: number; data: Buffer }[];
  frames: Buffer;
}

function parseFlacBlocks(buf: Buffer, start: number): { blocks: FlacParts['blocks']; end: number } {
  const blocks: FlacParts['blocks'] = [];
  let p = start;
  for (;;) {
    const header = buf[p];
    const length = buf.readUIntBE(p + 1, 3);
    blocks.push({ type: header & 0x7f, data: buf.subarray(p + 4, p + 4 + length) });
    p += 4 + length;
    if (header & 0x80 || p >= buf.length) break;
  }
  return { blocks, end: p };
}

function flacFromMp4(buf: Buffer): FlacParts {
  const top = { type: 'root', start: 0, end: buf.length };
  const moov = child(buf, top, 'moov');
  const trak = children(buf, moov.start, moov.end).find((b) => b.type === 'trak');
  if (!trak) throw new Error('MP4: нет дорожки');
  const stbl = descend(buf, trak, ['mdia', 'minf', 'stbl']);

  const stsd = child(buf, stbl, 'stsd');
  const entry = children(buf, stsd.start + 8, stsd.end).find((b) => b.type === 'fLaC');
  if (!entry) throw new Error('MP4: дорожка не FLAC');
  const dfla = children(buf, entry.start + 28, entry.end).find((b) => b.type === 'dfLa');
  if (!dfla) throw new Error('MP4: нет dfLa');
  const { blocks } = parseFlacBlocks(buf, dfla.start + 4);

  const stsz = child(buf, stbl, 'stsz');
  const fixedSize = buf.readUInt32BE(stsz.start + 4);
  const sampleCount = buf.readUInt32BE(stsz.start + 8);
  const sampleSize = (i: number) => fixedSize || buf.readUInt32BE(stsz.start + 12 + i * 4);

  const stsc = child(buf, stbl, 'stsc');
  const runs = Array.from({ length: buf.readUInt32BE(stsc.start + 4) }, (_, i) => ({
    firstChunk: buf.readUInt32BE(stsc.start + 8 + i * 12),
    samplesPerChunk: buf.readUInt32BE(stsc.start + 12 + i * 12),
  }));

  const offsets: number[] = [];
  const stco = children(buf, stbl.start, stbl.end).find((b) => b.type === 'stco' || b.type === 'co64');
  if (!stco) throw new Error('MP4: нет таблицы чанков');
  const chunkCount = buf.readUInt32BE(stco.start + 4);
  for (let i = 0; i < chunkCount; i++) {
    offsets.push(
      stco.type === 'co64'
        ? Number(buf.readBigUInt64BE(stco.start + 8 + i * 8))
        : buf.readUInt32BE(stco.start + 8 + i * 4),
    );
  }

  const parts: Buffer[] = [];
  let sample = 0;
  let run = 0;
  for (let chunk = 0; chunk < offsets.length && sample < sampleCount; chunk++) {
    while (run + 1 < runs.length && runs[run + 1].firstChunk <= chunk + 1) run++;
    let offset = offsets[chunk];
    for (let i = 0; i < runs[run].samplesPerChunk && sample < sampleCount; i++, sample++) {
      const size = sampleSize(sample);
      parts.push(buf.subarray(offset, offset + size));
      offset += size;
    }
  }
  return { blocks, frames: Buffer.concat(parts) };
}

function parseNativeFlac(buf: Buffer): FlacParts {
  if (buf.toString('latin1', 0, 4) !== 'fLaC') throw new Error('Файл не FLAC');
  const { blocks, end } = parseFlacBlocks(buf, 4);
  return { blocks, frames: buf.subarray(end) };
}

function vorbisComment(tags: AudioTags): Buffer {
  const entries = [
    `TITLE=${tags.title}`,
    `ARTIST=${tags.artist}`,
    ...(tags.album ? [`ALBUM=${tags.album}`] : []),
    ...(tags.trackNumber ? [`TRACKNUMBER=${tags.trackNumber}`] : []),
  ].map((s) => Buffer.from(s, 'utf8'));
  const vendor = Buffer.from('MusicStreamService', 'utf8');
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  return Buffer.concat([u32(vendor.length), vendor, u32(entries.length), ...entries.flatMap((e) => [u32(e.length), e])]);
}

function pictureBlock(cover: CoverImage): Buffer {
  const mime = Buffer.from(cover.mime, 'latin1');
  const head = Buffer.alloc(8 + mime.length + 4 + 16 + 4);
  let p = head.writeUInt32BE(3, 0);
  p = head.writeUInt32BE(mime.length, p);
  p += mime.copy(head, p);
  p = head.writeUInt32BE(0, p);
  p += 16;
  head.writeUInt32BE(cover.data.length, p);
  return Buffer.concat([head, cover.data]);
}

const FLAC_MAX_BLOCK = 0xffffff;
const FLAC_VORBIS_COMMENT = 4;
const FLAC_PICTURE = 6;
const FLAC_PADDING = 1;
const PADDING_BYTES = 4096;

function buildFlac({ blocks, frames }: FlacParts, tags: AudioTags, cover?: CoverImage): Buffer {
  const kept = blocks.filter((b) => ![FLAC_VORBIS_COMMENT, FLAC_PICTURE, FLAC_PADDING].includes(b.type));
  // Проводник Windows дублирует теги, если PICTURE идёт после VORBIS_COMMENT.
  if (cover) {
    const picture = pictureBlock(cover);
    if (picture.length <= FLAC_MAX_BLOCK) kept.push({ type: FLAC_PICTURE, data: picture });
  }
  kept.push({ type: FLAC_VORBIS_COMMENT, data: vorbisComment(tags) });
  kept.push({ type: FLAC_PADDING, data: Buffer.alloc(PADDING_BYTES) });
  const encoded = kept.map((b, i) => {
    const header = Buffer.alloc(4);
    header[0] = (i === kept.length - 1 ? 0x80 : 0) | b.type;
    header.writeUIntBE(b.data.length, 1, 3);
    return Buffer.concat([header, b.data]);
  });
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), ...encoded, frames]);
}

export function flacMp4ToTaggedFlac(buf: Buffer, tags: AudioTags, cover?: CoverImage): Buffer {
  return buildFlac(flacFromMp4(buf), tags, cover);
}

export function tagFlac(buf: Buffer, tags: AudioTags, cover?: CoverImage): Buffer {
  return buildFlac(parseNativeFlac(buf), tags, cover);
}

// --- MP3: ID3v2.3 ---

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function id3Frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function id3Text(id: string, text: string): Buffer {
  return id3Frame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf;
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
  const footer = buf[5] & 0x10 ? 10 : 0;
  return buf.subarray(10 + size + footer);
}

export function tagMp3(buf: Buffer, tags: AudioTags, cover?: CoverImage): Buffer {
  const frames = [
    id3Text('TIT2', tags.title),
    id3Text('TPE1', tags.artist),
    ...(tags.album ? [id3Text('TALB', tags.album)] : []),
    ...(tags.trackNumber ? [id3Text('TRCK', String(tags.trackNumber))] : []),
    ...(cover
      ? [
          id3Frame(
            'APIC',
            Buffer.concat([Buffer.from([0]), Buffer.from(`${cover.mime}\0`, 'latin1'), Buffer.from([3, 0]), cover.data]),
          ),
        ]
      : []),
  ];
  const body = Buffer.concat(frames);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), syncsafe(body.length)]);
  return Buffer.concat([header, body, stripId3(buf)]);
}
