import { BrowserWindow, shell } from 'electron';
import type { DeviceCodePrompt, LoginPrompt, LoginReply } from '@mss/shared';
import {
  ConnectorRegistry,
  createSpotifyWebConnector,
  createVkConnector,
  createYandexConnector,
  type YandexConnector,
} from '@mss/stream-connectors';
import { clientSecret } from './client-secrets.js';
import { spotifyPathfinder, spotifySpclient } from './spotify-pathfinder.js';
import { isSpotifyLoggedIn, spotifyWebLogout } from './spotify-web-session.js';
import { yandexCustomOAuthEnabled } from './user-client-secrets.js';
import { tokenVault } from './token-vault.js';
import { openKateOAuthWindow, showVkLoginWindow } from './vk-oauth.js';

export const connectorRegistry = new ConnectorRegistry();
let yandex: YandexConnector | null = null;

export function getYandex(): YandexConnector {
  if (!yandex) throw new Error('Yandex connector not initialized');
  return yandex;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function broadcastDeviceCode(prompt: DeviceCodePrompt): void {
  broadcast('connectors:deviceCode', prompt);
}

let pendingLogin: {
  resolve: (reply: LoginReply) => void;
  reject: (err: Error) => void;
} | null = null;

function waitForLogin(prompt: LoginPrompt, signal?: AbortSignal): Promise<LoginReply> {
  return new Promise((resolve, reject) => {
    pendingLogin?.reject(new Error('Отменено'));
    const finish = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      pendingLogin = null;
      fn();
    };
    const onAbort = () => finish(() => reject(new Error('Отменено')));
    pendingLogin = {
      resolve: (reply) => finish(() => resolve(reply)),
      reject: (err) => finish(() => reject(err)),
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);
    broadcast('connectors:loginPrompt', prompt);
  });
}

function pushLoginPrompt(prompt: LoginPrompt): void {
  broadcast('connectors:loginPrompt', prompt);
}

export function resolveLoginReply(reply: LoginReply): void {
  pendingLogin?.resolve(reply);
}

export function cancelPendingLogin(): void {
  pendingLogin?.reject(new Error('Отменено'));
}

function registerYandex(): void {
  const customYandexId = clientSecret('YANDEX_CLIENT_ID').trim();
  const customYandexSecret = clientSecret('YANDEX_CLIENT_SECRET').trim();
  const useCustomYandexOAuth = yandexCustomOAuthEnabled();
  yandex = createYandexConnector({
    vault: tokenVault,
    openExternal: (url) => shell.openExternal(url),
    onDeviceCode: broadcastDeviceCode,
    ...(useCustomYandexOAuth && customYandexId
      ? { clientId: customYandexId, clientSecret: customYandexSecret }
      : {}),
  });
  connectorRegistry.register(yandex);
}

function registerVk(): void {
  connectorRegistry.register(
    createVkConnector({
      vault: tokenVault,
      onLoginPrompt: (prompt, signal) => waitForLogin(prompt, signal),
      onLoginPromptUpdate: pushLoginPrompt,
      openKateOAuth: (url, signal) => openKateOAuthWindow(url, signal),
      focusVkLogin: () => showVkLoginWindow(),
    }),
  );
}

function registerSpotify(): void {
  connectorRegistry.register(
    createSpotifyWebConnector({
      query: spotifyPathfinder,
      spclient: spotifySpclient,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      loggedIn: isSpotifyLoggedIn,
      connect: async () => {
        throw new Error('Войдите в Spotify во встроенном веб-плеере: боковая панель → Spotify → Веб-плеер');
      },
      disconnect: spotifyWebLogout,
    }),
  );
}

export function initConnectors(): void {
  registerYandex();
  registerVk();
  registerSpotify();
}

/** После смены ключей в настройках — пересобрать коннекторы без перезапуска приложения. */
export function refreshConnectorsFromSecrets(): void {
  registerYandex();
  registerVk();
}
