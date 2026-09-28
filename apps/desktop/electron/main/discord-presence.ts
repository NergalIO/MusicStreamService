import { Client, StatusDisplayType, type SetActivity } from '@xhayper/discord-rpc';
import { BrowserWindow } from 'electron';
import { getAppSettings, onAppSettingsChange, resolveDiscordClientId } from './app-settings.js';
import { log } from './logger.js';
import { getLastPlayerState, getLastProgress, onPlayerProgress, onPlayerState } from './media.js';

/** ActivityType.Listening — статус «Слушает», не «Играет». */
const ACTIVITY_LISTENING = 2;

const ACTIVITY_GAP = 12_000;
const APP_NAME = 'MusicStream';

let client: Client | null = null;
let connecting = false;
let lastSent = 0;
let lastKey = '';

function clip(text: string, max: number): string {
  return text.slice(0, max);
}

function publicCoverUrl(coverUrl?: string): string | null {
  const url = coverUrl?.trim();
  if (!url || !/^https:\/\//i.test(url) || /localhost|127\.0\.0\.1/i.test(url)) return null;
  return url.replace(/400x400/i, 'm1000x1000');
}

function largeImage(s: ReturnType<typeof getLastPlayerState>): Pick<SetActivity, 'largeImageKey' | 'largeImageUrl' | 'largeImageText'> {
  const settings = getAppSettings();
  const album = (s.album || APP_NAME).trim();
  const text = clip(album, 128);
  if (!settings.discordShowCover) {
    return { largeImageKey: 'logo', largeImageText: text };
  }
  const url = publicCoverUrl(s.coverUrl);
  if (url) {
    const out: Pick<SetActivity, 'largeImageKey' | 'largeImageUrl' | 'largeImageText'> = {
      // В RPC поле large_image — ключ ассета или https-URL обложки (не large_url, это только ссылка по клику).
      largeImageKey: url,
      largeImageText: text,
    };
    const link = s.externalUrl?.trim();
    if (link && /^https:\/\//i.test(link)) out.largeImageUrl = link;
    return out;
  }
  return { largeImageKey: 'logo', largeImageText: text };
}

function activityKey(): string {
  const s = getLastPlayerState();
  const p = getLastProgress();
  const settings = getAppSettings();
  return [
    s.hasTrack,
    s.playing,
    s.title,
    s.artist,
    s.album,
    s.coverUrl,
    s.externalUrl,
    settings.discordShowCover,
    settings.discordShowButton,
    settings.discordShowOnPause,
    Math.floor((p?.position ?? 0) / 15),
  ].join('\0');
}

function buildActivity(): SetActivity | null {
  const s = getLastPlayerState();
  const settings = getAppSettings();
  if (!s.hasTrack) return null;
  if (!s.playing && !settings.discordShowOnPause) return null;

  const p = getLastProgress();
  const activity: SetActivity = {
    name: APP_NAME,
    type: ACTIVITY_LISTENING,
    details: clip(s.title || 'Трек', 128),
    state: clip(s.artist || APP_NAME, 128),
    statusDisplayType: StatusDisplayType.STATE,
    instance: false,
    ...largeImage(s),
    smallImageKey: s.playing ? 'play' : 'pause',
    smallImageText: s.playing ? 'Играет' : 'Пауза',
  };

  if (s.playing && p && p.duration > 0) {
    const start = Date.now() - Math.round(p.position * 1000);
    activity.startTimestamp = start;
    activity.endTimestamp = start + Math.round(p.duration * 1000);
  }

  const link = s.externalUrl?.trim();
  if (settings.discordShowButton && link && /^https:\/\//i.test(link)) {
    activity.buttons = [{ label: clip('Открыть трек', 32), url: link }];
  }

  return activity;
}

async function publish(force = false): Promise<void> {
  if (!client?.user || !getAppSettings().discordPresence) return;
  const key = activityKey();
  const now = Date.now();
  if (!force && key === lastKey && now - lastSent < ACTIVITY_GAP) return;
  lastKey = key;
  lastSent = now;
  try {
    const activity = buildActivity();
    if (!activity) await client.user.clearActivity();
    else await client.user.setActivity(activity);
  } catch (e) {
    log.warn('discord presence', e instanceof Error ? e.message : String(e));
  }
}

function notifyMissingClientId(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('discord:missingClientId');
  }
}

async function connect(): Promise<void> {
  const id = resolveDiscordClientId();
  if (!id) {
    if (getAppSettings().discordPresence) notifyMissingClientId();
    return;
  }
  if (connecting || client) return;
  connecting = true;
  try {
    const next = new Client({ clientId: id, transport: { type: 'ipc' } });
    next.on('disconnected', () => {
      client = null;
      lastKey = '';
    });
    await next.login();
    client = next;
    lastKey = '';
    await publish(true);
  } catch (e) {
    log.warn('discord rpc', e instanceof Error ? e.message : String(e));
    client = null;
  } finally {
    connecting = false;
  }
}

async function disconnect(): Promise<void> {
  const current = client;
  client = null;
  lastKey = '';
  if (!current) return;
  try {
    await current.user?.clearActivity();
    await current.destroy();
  } catch {
    /* Discord мог уже закрыться */
  }
}

async function reconnect(): Promise<void> {
  await disconnect();
  await connect();
}

function presenceOptionsChanged(next: ReturnType<typeof getAppSettings>, prev: ReturnType<typeof getAppSettings>): boolean {
  return (
    next.discordShowCover !== prev.discordShowCover ||
    next.discordShowButton !== prev.discordShowButton ||
    next.discordShowOnPause !== prev.discordShowOnPause
  );
}

export function initDiscordPresence(): void {
  onAppSettingsChange((next, prev) => {
    if (next.discordPresence !== prev.discordPresence) {
      if (next.discordPresence) void connect();
      else void disconnect();
      return;
    }
    if (next.discordClientId !== prev.discordClientId && next.discordPresence) void reconnect();
    if (presenceOptionsChanged(next, prev) && next.discordPresence) void publish(true);
  });
  onPlayerState(() => void publish(true));
  onPlayerProgress(() => void publish());
  if (getAppSettings().discordPresence) void connect();
}

export function disposeDiscordPresence(): void {
  void disconnect();
}
