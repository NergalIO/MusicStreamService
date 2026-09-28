import { BrowserWindow, shell } from 'electron';
import type { DeviceCodePrompt } from '@mss/shared';
import {
  ConnectorRegistry,
  createSpotifyConnector,
  createYandexConnector,
  type YandexConnector,
} from '@mss/stream-connectors';
import { clientSecret } from './client-secrets.js';
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

export function initConnectors(): void {
  const spotifyClientId = clientSecret('SPOTIFY_CLIENT_ID');
  if (spotifyClientId) {
    connectorRegistry.register(
      createSpotifyConnector({
        clientId: spotifyClientId,
        vault: tokenVault,
        openExternal: (url) => shell.openExternal(url),
      }),
    );
  }

  const customYandexId = clientSecret('YANDEX_CLIENT_ID').trim();
  const customYandexSecret = clientSecret('YANDEX_CLIENT_SECRET').trim();
  const useCustomYandexOAuth =
    process.env.MSS_YANDEX_CUSTOM_OAUTH === '1' || process.env.MSS_YANDEX_CUSTOM_OAUTH === 'true';
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
