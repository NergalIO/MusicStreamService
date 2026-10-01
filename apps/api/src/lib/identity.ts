export function foldText(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function localArtistLikeId(name: string): string {
  return foldText(name).slice(0, 200);
}

export function normalizeAlbumIdentity(title: string, artist: string): string {
  return `${foldText(title)}\0${foldText(artist)}`;
}

export function normalizeTrackIdentity(title: string, artist: string): string {
  return `${foldText(title)}\0${foldText(artist)}`;
}

export function durationClose(a: number | null | undefined, b: number | null | undefined): boolean {
  if (!a || !b) return true;
  return Math.abs(a - b) <= 8000;
}

export type TrackIdentity = {
  id: string;
  title: string;
  artist: string;
  contentHash?: string | null;
  durationMs?: number | null;
};

export function sameTrack(a: TrackIdentity, b: TrackIdentity): boolean {
  if (a.id === b.id) return true;
  const ha = a.contentHash?.toLowerCase();
  const hb = b.contentHash?.toLowerCase();
  if (ha && hb && ha === hb) return true;
  return (
    normalizeTrackIdentity(a.title, a.artist) === normalizeTrackIdentity(b.title, b.artist) &&
    durationClose(a.durationMs, b.durationMs)
  );
}

export function artistNameMatches(albumArtist: string, name: string): boolean {
  const key = foldText(name);
  if (!key) return false;
  const folded = foldText(albumArtist);
  if (folded === key) return true;
  return folded.split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*/i).some((part) => foldText(part) === key);
}

/** Оставляет один трек на песню: совпадение по хешу или названию+исполнителю. */
export function pickCanonicalTracks<T extends TrackIdentity>(rows: T[], rank?: (a: T, b: T) => number): T[] {
  const groups: T[][] = [];
  for (const row of rows) {
    const group = groups.find((items) => sameTrack(items[0], row));
    if (group) group.push(row);
    else groups.push([row]);
  }
  return groups.map((group) => {
    if (group.length === 1 || !rank) return group[0];
    return [...group].sort(rank)[0];
  });
}
