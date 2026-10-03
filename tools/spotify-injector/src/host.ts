import {
  SpotifyInjectorSession,
  TabMissingError,
  installBridgeSource,
  isPathfinderUrl,
  rememberPathfinderRequest,
  type SpotifyCapturedState,
  type SpotifyPageHost,
} from '@mss/stream-connectors';
import type { Session, WebContents } from 'electron';

const HOME = 'https://open.spotify.com/';

export function createElectronPageHost(wc: WebContents): SpotifyPageHost {
  return {
    evaluate: async <T>(expression: string) => {
      if (wc.isDestroyed()) throw new TabMissingError();
      return (await wc.executeJavaScript(expression, true)) as T;
    },
    getUrl: () => {
      if (wc.isDestroyed()) return '';
      return wc.getURL();
    },
    loadURL: async (url: string) => {
      if (wc.isDestroyed()) throw new TabMissingError();
      await wc.loadURL(url);
    },
    getCookieNames: async () => {
      if (wc.isDestroyed()) throw new TabMissingError();
      const cookies = await wc.session.cookies.get({ url: HOME });
      return cookies.map((c) => c.name);
    },
    typeText: async (text: string, opts?: { selectAll?: boolean }) => {
      if (wc.isDestroyed()) throw new TabMissingError();
      wc.focus();
      if (opts?.selectAll !== false) {
        const modifier = process.platform === 'darwin' ? 'meta' : 'control';
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [modifier] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [modifier] });
      }
      for (const ch of text) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
        wc.sendInputEvent({ type: 'char', keyCode: ch });
        wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
      }
    },
    focusPage: async () => {
      if (wc.isDestroyed()) throw new TabMissingError();
      wc.focus();
    },
  };
}

export function createHarnessSession(wc: WebContents): {
  session: SpotifyInjectorSession;
  captured: SpotifyCapturedState;
  injectBridge: () => Promise<void>;
  watchRequests: () => void;
} {
  const captured: SpotifyCapturedState = {
    accessToken: null,
    clientToken: null,
    connectionId: null,
    appVersion: null,
  };
  const host = createElectronPageHost(wc);
  const session = new SpotifyInjectorSession(host, captured);
  const bridgeSource = installBridgeSource();

  return {
    session,
    captured,
    injectBridge: async () => {
      if (wc.isDestroyed()) return;
      const url = wc.getURL();
      if (!url.includes('open.spotify.com')) return;
      await wc.executeJavaScript(bridgeSource, true);
    },
    watchRequests: () => {
      const target: Session = wc.session;
      target.webRequest.onBeforeRequest(
        { urls: ['https://api-partner.spotify.com/pathfinder/*'] },
        (details, callback) => {
          if (isPathfinderUrl(details.url) && details.uploadData?.length) {
            const chunks = details.uploadData
              .map((part) => (part.bytes ? Buffer.from(part.bytes).toString('utf8') : ''))
              .filter(Boolean);
            if (chunks.length) {
              rememberPathfinderRequest(session.hashCacheRef, details.url, chunks.join(''));
              session.rememberPathfinder(details.url, chunks.join(''));
            }
          }
          callback({});
        },
      );
      target.webRequest.onBeforeSendHeaders({ urls: ['https://*.spotify.com/*'] }, (details, callback) => {
        const headers = details.requestHeaders ?? {};
        session.ingestRequestHeaders(headers as Record<string, string>);
        callback({ requestHeaders: headers });
      });
    },
  };
}

export { TabMissingError };
