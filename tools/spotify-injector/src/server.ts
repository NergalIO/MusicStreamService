import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  TabMissingError,
  parseLikeBody,
  parseLoginBody,
  parsePlayUri,
  parseSearchLimit,
  parseTrackUri,
  parseTransferBody,
  toPublicSnapshot,
  type PlaybackSnapshot,
  type SpotifyInjectorSession,
} from '@mss/stream-connectors';

const POLL_MS = 400;
const POSITION_BROADCAST_MS = 1000;

interface StartServerOptions {
  port: number;
  session: SpotifyInjectorSession;
}

export interface RunningServer {
  close(): Promise<void>;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function snapshotChanged(a: PlaybackSnapshot | null, b: PlaybackSnapshot): boolean {
  if (!a) return true;
  if (a.uri !== b.uri) return true;
  if (a.isPlaying !== b.isPlaying) return true;
  if (a.liked !== b.liked) return true;
  if (a.title !== b.title) return true;
  if (a.shuffle !== b.shuffle) return true;
  if (a.repeat !== b.repeat) return true;
  if (a.muted !== b.muted) return true;
  const volA = a.volume == null ? null : Math.round(a.volume * 100);
  const volB = b.volume == null ? null : Math.round(b.volume * 100);
  return volA !== volB;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { port, session } = options;
  let lastSnapshot: PlaybackSnapshot | null = null;
  let lastPositionBroadcast = 0;

  const httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  function broadcast(snapshot: PlaybackSnapshot): void {
    const payload = JSON.stringify(snapshot);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  async function currentSnapshot(): Promise<PlaybackSnapshot> {
    const sample = await session.getState();
    return toPublicSnapshot(sample);
  }

  async function afterCommand(): Promise<PlaybackSnapshot> {
    const snapshot = await currentSnapshot();
    lastSnapshot = snapshot;
    lastPositionBroadcast = Date.now();
    broadcast(snapshot);
    return snapshot;
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/events') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    void (async () => {
      try {
        const snapshot = await currentSnapshot();
        lastSnapshot = snapshot;
        ws.send(JSON.stringify(snapshot));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ws.send(JSON.stringify({ ok: false, error: message }));
      }
    })();
  });

  const pollTimer = setInterval(() => {
    void (async () => {
      try {
        const snapshot = await currentSnapshot();
        const now = Date.now();
        const moved = snapshot.isPlaying && now - lastPositionBroadcast >= POSITION_BROADCAST_MS;
        if (snapshotChanged(lastSnapshot, snapshot) || moved) {
          lastSnapshot = snapshot;
          if (moved) lastPositionBroadcast = now;
          broadcast(snapshot);
        }
      } catch {
        // tab may be momentarily gone
      }
    })();
  }, POLL_MS);

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, await session.health());
        return;
      }

      if (method === 'GET' && url.pathname === '/auth') {
        sendJson(res, 200, await session.getAuth());
        return;
      }

      if (method === 'POST' && url.pathname === '/auth') {
        const parsed = parseLoginBody(await readJson(req));
        if ('error' in parsed) {
          sendJson(res, 400, { ok: false, error: parsed.error });
          return;
        }
        sendJson(res, 200, await session.login(parsed));
        return;
      }

      if (method === 'GET' && url.pathname === '/state') {
        sendJson(res, 200, await currentSnapshot());
        return;
      }

      if (method === 'GET' && url.pathname === '/debug/methods') {
        sendJson(res, 200, await session.getMethods());
        return;
      }

      if (method === 'GET' && url.pathname === '/debug/dom') {
        sendJson(res, 200, await session.getDomDebug());
        return;
      }

      if (method === 'GET' && url.pathname === '/debug/playback') {
        sendJson(res, 200, await session.getPlaybackDebug());
        return;
      }

      if (method === 'POST' && url.pathname === '/pause') {
        const result = await session.command('pause');
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/resume') {
        const result = await session.command('resume');
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/next') {
        const result = await session.command('next');
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/previous') {
        const result = await session.command('previous');
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/play') {
        const body = (await readJson(req)) as { uri?: unknown; offsetUri?: unknown; positionMs?: unknown };
        if (typeof body.uri !== 'string') {
          sendJson(res, 400, { ok: false, error: 'invalid_uri' });
          return;
        }
        const parsed = parsePlayUri(body.uri);
        if (!parsed) {
          sendJson(res, 400, { ok: false, error: 'invalid_uri' });
          return;
        }
        let offsetUri: string | undefined;
        if (body.offsetUri !== undefined) {
          if (typeof body.offsetUri !== 'string') {
            sendJson(res, 400, { ok: false, error: 'invalid_offset_uri' });
            return;
          }
          const offset = parseTrackUri(body.offsetUri);
          if (!offset) {
            sendJson(res, 400, { ok: false, error: 'invalid_offset_uri' });
            return;
          }
          offsetUri = offset.uri;
        }
        let positionMs: number | undefined;
        if (body.positionMs !== undefined) {
          if (typeof body.positionMs !== 'number' || !Number.isFinite(body.positionMs) || body.positionMs < 0) {
            sendJson(res, 400, { ok: false, error: 'invalid_position' });
            return;
          }
          positionMs = body.positionMs;
        }
        const result = await session.command('play', { uri: parsed.uri, offsetUri, positionMs });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/volume') {
        const body = (await readJson(req)) as { level?: unknown };
        if (typeof body.level !== 'number' || !Number.isFinite(body.level) || body.level < 0 || body.level > 1) {
          sendJson(res, 400, { ok: false, error: 'invalid_volume' });
          return;
        }
        const result = await session.command('setVolume', { level: body.level });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/seek') {
        const body = (await readJson(req)) as { positionMs?: unknown };
        if (
          typeof body.positionMs !== 'number' ||
          !Number.isFinite(body.positionMs) ||
          body.positionMs < 0
        ) {
          sendJson(res, 400, { ok: false, error: 'invalid_position' });
          return;
        }
        const result = await session.command('seek', { positionMs: body.positionMs });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/shuffle') {
        const body = (await readJson(req)) as { enabled?: unknown };
        if (typeof body.enabled !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'invalid_shuffle' });
          return;
        }
        const result = await session.command('setShuffle', { enabled: body.enabled });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/repeat') {
        const body = (await readJson(req)) as { mode?: unknown };
        if (body.mode !== 'off' && body.mode !== 'context' && body.mode !== 'track') {
          sendJson(res, 400, { ok: false, error: 'invalid_repeat' });
          return;
        }
        const result = await session.command('setRepeat', { mode: body.mode });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/mute') {
        const body = (await readJson(req)) as { muted?: unknown };
        if (typeof body.muted !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'invalid_mute' });
          return;
        }
        const result = await session.command('setMute', { muted: body.muted });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && url.pathname === '/queue') {
        const body = (await readJson(req)) as { uri?: unknown };
        if (typeof body.uri !== 'string') {
          sendJson(res, 400, { ok: false, error: 'invalid_uri' });
          return;
        }
        const parsed = parseTrackUri(body.uri);
        if (!parsed) {
          sendJson(res, 400, { ok: false, error: 'invalid_uri' });
          return;
        }
        const result = await session.command('queue', { uri: parsed.uri });
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      if (method === 'GET' && url.pathname === '/like') {
        const rawUri = url.searchParams.get('uri');
        if (rawUri) {
          const parsed = parsePlayUri(rawUri);
          if (!parsed) {
            sendJson(res, 400, { ok: false, error: 'invalid_uri' });
            return;
          }
          sendJson(res, 200, await session.getLike(parsed.uri));
          return;
        }
        sendJson(res, 200, await session.getLike());
        return;
      }

      if (method === 'POST' && url.pathname === '/like') {
        const parsed = parseLikeBody(await readJson(req));
        if ('error' in parsed) {
          sendJson(res, 400, { ok: false, error: parsed.error });
          return;
        }
        if (parsed.uri) {
          const uri = parsePlayUri(parsed.uri);
          if (!uri) {
            sendJson(res, 400, { ok: false, error: 'invalid_uri' });
            return;
          }
          sendJson(res, 200, await session.setLike(uri.uri, parsed.liked));
          return;
        }
        sendJson(res, 200, await session.setLike(undefined, parsed.liked));
        return;
      }

      if (method === 'GET' && url.pathname === '/search') {
        const query = url.searchParams.get('q')?.trim() ?? '';
        if (!query) {
          sendJson(res, 400, { ok: false, error: 'invalid_query' });
          return;
        }
        const limit = parseSearchLimit(url.searchParams.get('limit'));
        if (typeof limit === 'object') {
          sendJson(res, 400, { ok: false, error: limit.error });
          return;
        }
        sendJson(res, 200, await session.searchCatalog(query, limit));
        return;
      }

      if (method === 'GET' && url.pathname === '/lyrics') {
        const rawUri = url.searchParams.get('uri');
        if (rawUri) {
          const parsed = parseTrackUri(rawUri);
          if (!parsed) {
            sendJson(res, 400, { ok: false, error: 'invalid_uri' });
            return;
          }
          sendJson(res, 200, await session.getLyrics(parsed.uri));
          return;
        }
        sendJson(res, 200, await session.getLyrics());
        return;
      }

      if (method === 'GET' && url.pathname === '/devices') {
        sendJson(res, 200, await session.getDevices());
        return;
      }

      if (method === 'POST' && url.pathname === '/transfer') {
        const parsed = parseTransferBody(await readJson(req));
        if ('error' in parsed) {
          sendJson(res, 400, { ok: false, error: parsed.error });
          return;
        }
        const result = await session.transferPlayback(parsed.deviceId, parsed.play);
        if (result.ok) await afterCommand();
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' });
        return;
      }
      if (err instanceof TabMissingError) {
        sendJson(res, 503, { ok: false, error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return {
    close() {
      clearInterval(pollTimer);
      return new Promise((resolve, reject) => {
        for (const client of wss.clients) client.close();
        wss.close(() => {
          httpServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    },
  };
}
