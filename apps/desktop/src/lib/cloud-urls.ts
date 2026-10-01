const STORAGE_KEY = 'mss_cloud_urls';
const SKEW_MS = 60_000;

export interface CloudUrlEntry {
  cloudPlayUrl?: string | null;
  cloudDownloadUrl?: string | null;
  cloudUrlExpiresAt?: string | null;
}

function loadAll(): Record<string, CloudUrlEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, CloudUrlEntry>;
  } catch {
    return {};
  }
}

export function isFreshCloudUrl(url?: string | null, expiresAt?: string | null): url is string {
  if (!url || !expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > Date.now() + SKEW_MS;
}

export function rememberCloudUrls(trackId: string, entry: CloudUrlEntry): void {
  if (!isFreshCloudUrl(entry.cloudPlayUrl, entry.cloudUrlExpiresAt) && !isFreshCloudUrl(entry.cloudDownloadUrl, entry.cloudUrlExpiresAt)) {
    return;
  }
  const all = loadAll();
  all[trackId] = {
    cloudPlayUrl: entry.cloudPlayUrl || undefined,
    cloudDownloadUrl: entry.cloudDownloadUrl || undefined,
    cloudUrlExpiresAt: entry.cloudUrlExpiresAt || undefined,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}

export function cachedCloudUrls(trackId: string): CloudUrlEntry | undefined {
  return loadAll()[trackId];
}

export function freshCloudPlayUrl(track: {
  id: string;
  cloudPlayUrl?: string | null;
  cloudUrlExpiresAt?: string | null;
}): string | null {
  if (isFreshCloudUrl(track.cloudPlayUrl, track.cloudUrlExpiresAt)) return track.cloudPlayUrl;
  const cached = cachedCloudUrls(track.id);
  if (cached && isFreshCloudUrl(cached.cloudPlayUrl, cached.cloudUrlExpiresAt)) return cached.cloudPlayUrl;
  return null;
}

export function freshCloudDownloadUrl(track: {
  id: string;
  cloudDownloadUrl?: string | null;
  cloudUrlExpiresAt?: string | null;
}): string | null {
  if (isFreshCloudUrl(track.cloudDownloadUrl, track.cloudUrlExpiresAt)) return track.cloudDownloadUrl;
  const cached = cachedCloudUrls(track.id);
  if (cached && isFreshCloudUrl(cached.cloudDownloadUrl, cached.cloudUrlExpiresAt)) return cached.cloudDownloadUrl;
  return null;
}

export function audioContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'm4a':
    case 'aac':
      return 'audio/mp4';
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'aif':
    case 'aiff':
      return 'audio/aiff';
    default:
      return 'application/octet-stream';
  }
}
