import type { TrackLyrics } from '@mss/shared';

interface SpotifyLyricsLine {
  startTimeMs?: string | number;
  words?: string;
}

interface SpotifyLyricsPayload {
  lyrics?: {
    syncType?: string;
    lines?: SpotifyLyricsLine[];
    credits?: { sourceNames?: string[] };
  };
}

export function mapSpotifyLyrics(data: SpotifyLyricsPayload): TrackLyrics | null {
  const block = data.lyrics;
  if (!block?.lines?.length) return null;
  const synced = block.syncType === 'LINE_SYNCED' || block.syncType === 'SYLLABLE_SYNCED';
  const lines = block.lines
    .map((line) => ({
      timeMs: synced ? Number(line.startTimeMs ?? 0) : -1,
      text: line.words ?? '',
    }))
    .filter((line) => line.text.trim() || synced);
  if (!lines.some((line) => line.text.trim())) return null;
  const writers = block.credits?.sourceNames?.filter(Boolean);
  return { synced, lines, writers: writers?.length ? writers : undefined };
}

export async function fetchSpotifyLyrics(
  spclient: (path: string) => Promise<unknown>,
  trackId: string,
): Promise<TrackLyrics | null> {
  const id = trackId.split(':').pop()?.trim();
  if (!id) return null;
  const path =
    `/color-lyrics/v2/track/${encodeURIComponent(id)}?format=json&vocalRemoval=false&market=from_token`;
  try {
    const data = (await spclient(path)) as SpotifyLyricsPayload;
    return mapSpotifyLyrics(data);
  } catch (e) {
    if (e instanceof Error && /\b404\b/.test(e.message)) return null;
    throw e;
  }
}
