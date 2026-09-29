import { describe, expect, it } from 'vitest';
import {
  artistsFromTracks,
  isVkAudioStub,
  mapVkPlaylist,
  mapVkTrack,
  parseVkAudioId,
  vkTrackId,
} from '../src/vk-mappers.js';
import type { VkAudio } from '../src/vk-mappers.js';

const sample: VkAudio = {
  id: 42,
  owner_id: -2001,
  artist: 'Artist',
  title: 'Song',
  duration: 125,
  url: 'https://vk.com/audio.mp3',
  access_key: 'abc',
  album: { id: 7, title: 'LP', thumb: { photo_600: 'https://img/cover.jpg' } },
  main_artists: [{ id: 9, name: 'Artist' }],
  is_explicit: 1,
};

describe('vk mappers', () => {
  it('maps a playable track', () => {
    const t = mapVkTrack(sample);
    expect(t.source).toBe('vk');
    expect(t.id).toBe('-2001_42_abc');
    expect(t.durationMs).toBe(125_000);
    expect(t.coverUrl).toBe('https://img/cover.jpg');
    expect(t.playable).toBe(true);
    expect(t.explicit).toBe(true);
    expect(t.artists?.[0]).toEqual({ id: '9', name: 'Artist' });
  });

  it('detects vk.com placeholder stub', () => {
    expect(
      isVkAudioStub({
        id: 1,
        owner_id: 1,
        artist: 'и в официальных приложениях ВКонтакте',
        title: 'Аудио доступно на vk.com',
        duration: 25,
      }),
    ).toBe(true);
    expect(isVkAudioStub(sample)).toBe(false);
  });

  it('marks restricted tracks unplayable', () => {
    const t = mapVkTrack({ ...sample, url: '', content_restricted: 1 });
    expect(t.playable).toBe(false);
    expect(t.unplayableReason).toMatch(/недоступен/i);
  });

  it('parses composite ids', () => {
    expect(parseVkAudioId(vkTrackId(sample))).toEqual({ ownerId: -2001, audioId: 42, accessKey: 'abc' });
  });

  it('maps playlists and groups artists', () => {
    const p = mapVkPlaylist({ id: 3, owner_id: 1, title: 'Mix', count: 10, photo: { photo_600: 'https://p.jpg' } });
    expect(p.id).toBe('1_3');
    expect(p.trackCount).toBe(10);
    const artists = artistsFromTracks([sample, { ...sample, id: 43, main_artists: [{ id: 9, name: 'Artist' }] }], 5);
    expect(artists).toHaveLength(1);
    expect(artists[0].source).toBe('vk');
  });
});
