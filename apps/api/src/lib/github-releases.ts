import { config } from '../config.js';

export type ReleaseDownloadInfo = {
  tag: string | null;
  githubReleasePage: string | null;
  windowsExeUrl: string | null;
  androidApkUrl: string | null;
};

type GhAsset = { name: string; browser_download_url: string };
type GhRelease = {
  tag_name: string;
  html_url: string;
  assets: GhAsset[];
};

let cache: { at: number; data: ReleaseDownloadInfo } | null = null;

const CACHE_MS = 10 * 60 * 1000;

function assetUrl(release: GhRelease, fileName: string): string | null {
  const asset = release.assets.find((a) => a.name === fileName);
  return asset?.browser_download_url ?? null;
}

export async function fetchLatestReleaseDownloads(): Promise<ReleaseDownloadInfo> {
  const empty: ReleaseDownloadInfo = {
    tag: null,
    githubReleasePage: null,
    windowsExeUrl: null,
    androidApkUrl: null,
  };
  const repo = config.githubRepo.trim();
  if (!repo) return empty;

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MusicStreamService-Landing',
        ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
      },
    });
    if (!res.ok) {
      return empty;
    }
    const release = (await res.json()) as GhRelease;
    const data: ReleaseDownloadInfo = {
      tag: release.tag_name ?? null,
      githubReleasePage: release.html_url ?? null,
      windowsExeUrl: assetUrl(release, config.githubReleaseExeName),
      androidApkUrl: assetUrl(release, config.githubReleaseApkName),
    };
    cache = { at: now, data };
    return data;
  } catch {
    return empty;
  }
}
