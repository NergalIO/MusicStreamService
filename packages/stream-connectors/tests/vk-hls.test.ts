import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeSegment, decryptAes128Cbc, demuxMpegTsAudio, mediaSequenceIv, parseM3u8 } from '../src/vk-hls.js';

describe('parseM3u8', () => {
  it('parses keys, IVs and relative segment URLs', () => {
    const text = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000005
#EXTINF:5.994,
seg0.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:6.0,
seg1.ts
#EXT-X-ENDLIST
`;
    const playlist = parseM3u8(text, 'https://cdn.example/audio/index.m3u8');
    expect(playlist.mediaSequence).toBe(5);
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments[0].url).toBe('https://cdn.example/audio/seg0.ts');
    expect(playlist.segments[0].key?.method).toBe('AES-128');
    expect(playlist.segments[0].key?.uri).toBe('https://cdn.example/audio/key.bin');
    expect(playlist.segments[0].key?.iv?.equals(Buffer.from('00000000000000000000000000000005', 'hex'))).toBe(true);
    expect(playlist.segments[0].mediaSequence).toBe(5);
    expect(playlist.segments[1].key).toBeNull();
    expect(playlist.segments[1].url).toBe('https://cdn.example/audio/seg1.ts');
  });

  it('fills default IV from media sequence', () => {
    const text = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:9
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/k"
#EXTINF:1,
a.ts
`;
    const playlist = parseM3u8(text, 'https://cdn.example/index.m3u8');
    expect(playlist.segments[0].key?.iv?.equals(mediaSequenceIv(9))).toBe(true);
  });
});

describe('AES-128 CBC', () => {
  it('round-trips a padded block', () => {
    const key = Buffer.alloc(16, 7);
    const iv = mediaSequenceIv(1);
    const plain = Buffer.from('0123456789abcdef0123456789abcdef');
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    expect(decryptAes128Cbc(enc, key, iv).equals(plain)).toBe(true);
  });
});

function tsPacket(pid: number, payload: Buffer, pusi: boolean, cc: number): Buffer {
  const packet = Buffer.alloc(188, 0xff);
  packet[0] = 0x47;
  packet[1] = (pusi ? 0x40 : 0) | ((pid >> 8) & 0x1f);
  packet[2] = pid & 0xff;
  packet[3] = 0x10 | (cc & 0x0f);
  payload.copy(packet, 4);
  return packet;
}

describe('demuxMpegTsAudio', () => {
  it('extracts PES payload from PAT/PMT/audio packets', () => {
    const pat = Buffer.from([
      0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const pmt = Buffer.from([
      0x00, 0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x01, 0xf0, 0x00, 0x03, 0xe1, 0x01, 0xf0, 0x00, 0x00,
      0x00, 0x00, 0x00,
    ]);
    const payload = Buffer.from('HELLOMP3DATA');
    const pes = Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0xc0, 0x00, 3 + payload.length, 0x80, 0x00, 0x00]), payload]);
    const ts = Buffer.concat([tsPacket(0, pat, true, 0), tsPacket(0x100, pmt, true, 0), tsPacket(0x101, pes, true, 0)]);
    expect(demuxMpegTsAudio(ts).toString()).toBe('HELLOMP3DATA');
  });

  it('passes through raw MP3', () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]);
    expect(demuxMpegTsAudio(mp3).equals(mp3)).toBe(true);
  });

  it('decodeSegment decrypts then demuxes', () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22]);
    const key = Buffer.alloc(16, 3);
    const iv = mediaSequenceIv(0);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const enc = Buffer.concat([cipher.update(mp3), cipher.final()]);
    expect(decodeSegment(enc, key, iv).equals(mp3)).toBe(true);
  });
});
