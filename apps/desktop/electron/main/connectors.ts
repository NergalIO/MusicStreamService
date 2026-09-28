import { BrowserWindow, shell } from 'electron';
import type { DeviceCodePrompt } from '@mss/shared';
import {
  ConnectorRegistry,
  createSpotifyConnector,
  createYandexConnector,
  type YandexConnector,
} from '@mss/stream-connectors';
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
  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID ?? '';
  if (spotifyClientId) {
    connectorRegistry.register(
      createSpotifyConnector({
        clientId: spotifyClientId,
        vault: tokenVault,
        openExternal: (url) => shell.openExternal(url),
      }),
    );
  }

  yandex = createYandexConnector({
    vault: tokenVault,
    openExternal: (url) => shell.openExternal(url),
    onDeviceCode: broadcastDeviceCode,
    clientId: process.env.YANDEX_MUSIC_CLIENT_ID,
    clientSecret: process.env.YANDEX_MUSIC_CLIENT_SECRET,
  });
  connectorRegistry.register(yandex);
}
