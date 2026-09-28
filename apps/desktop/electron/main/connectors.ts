import { BrowserWindow, shell } from 'electron';
import type { DeviceCodePrompt } from '@mss/shared';
import {
  ConnectorRegistry,
  createSpotifyConnector,
  createYandexConnector,
  type YandexConnector,
} from '@mss/stream-connectors';
import { clientSecret } from './client-secrets.js';
import { yandexCustomOAuthEnabled } from './user-client-secrets.js';
import { tokenVault } from './token-vault.js';

export const connectorRegistry = new ConnectorRegistry();
let yandex: YandexConnector | null = null;

export function getYandex(): YandexConnector {
  if (!yandex) throw new Error('Yandex connector not initialized');
  return yandex;
}

function broadcastDeviceCode(prompt: DeviceCodePrompt): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('connectors:deviceCode', prompt);
  }
}

function registerSpotify(): void {
  const spotifyClientId = clientSecret('SPOTIFY_CLIENT_ID');
  if (spotifyClientId) {
    connectorRegistry.register(
      createSpotifyConnector({
        clientId: spotifyClientId,
        vault: tokenVault,
        openExternal: (url) => shell.openExternal(url),
      }),
    );
  } else {
    connectorRegistry.unregister('spotify');
  }
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

export function initConnectors(): void {
  registerSpotify();
  registerYandex();
}

/** После смены ключей в настройках — пересобрать коннекторы без перезапуска приложения. */
export function refreshConnectorsFromSecrets(): void {
  registerSpotify();
  registerYandex();
}
