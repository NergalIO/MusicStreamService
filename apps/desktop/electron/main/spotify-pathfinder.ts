import { app } from 'electron';
import { invalidateSpotifyWebHeaders, spotifyWebExec, spotifyWebHeaders, type SpotifyWebHeaders } from './spotify-web-session.js';

const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query';
const SPCLIENT = 'https://spclient.wg.spotify.com';

function playerHeaders(h: SpotifyWebHeaders): Record<string, string> {
  return {
    authorization: h.authorization,
    'client-token': h.clientToken,
    'spotify-app-version': h.appVersion,
    'app-platform': 'WebPlayer',
    accept: 'application/json',
    'accept-language': app.getLocale() || 'ru',
  };
}
/** Операции поиска живут в лениво загружаемом чанке — его URL берём из карты чанков webpack. */
const LAZY_CHUNKS = ['xpui-routes-search'];

/**
 * Сканирует бандл веб-плеера: persisted queries объявлены как `("имя","query","sha256",…)`.
 * Выполняется внутри open.spotify.com, чтобы брать ровно ту сборку, что сейчас открыта.
 */
const SCAN_OPERATIONS = `(async () => {
  const urls = new Set(
    [...document.querySelectorAll('script[src]')].map((s) => s.src)
      .concat(performance.getEntriesByType('resource').map((e) => e.name))
      .filter((u) => /\\/cdn\\/build\\/web-player\\/[^/]+\\.js$/.test(u)),
  );
  const main = [...urls].find((u) => /\\/web-player\\.[0-9a-f]+\\.js$/.test(u));
  if (!main) return {};
  const mainText = await (await fetch(main)).text();
  for (const name of ${JSON.stringify(LAZY_CHUNKS)}) {
    const id = mainText.match(new RegExp('(\\\\d+):"' + name + '"'))?.[1];
    const hash = id && mainText.match(new RegExp('[,{]' + id + ':"([0-9a-f]{8})"'))?.[1];
    if (hash) urls.add(main.replace(/[^/]+$/, name + '.' + hash + '.js'));
  }
  const ops = {};
  const re = /"([A-Za-z0-9_]+)","(?:query|mutation)","([0-9a-f]{64})"/g;
  for (const u of urls) {
    const text = u === main ? mainText : await fetch(u).then((r) => r.text()).catch(() => '');
    for (const m of text.matchAll(re)) ops[m[1]] ??= m[2];
  }
  return ops;
})()`;

let hashes: Record<string, string> = {};
let scanning: Promise<void> | null = null;

function rescan(): Promise<void> {
  scanning ??= spotifyWebExec<Record<string, string>>(SCAN_OPERATIONS)
    .then((found) => {
      if (Object.keys(found).length) hashes = found;
    })
    .finally(() => {
      scanning = null;
    });
  return scanning;
}

async function operationHash(name: string, force = false): Promise<string> {
  if (force || !hashes[name]) await rescan();
  const hash = hashes[name];
  if (!hash) throw new Error(`Веб-плеер Spotify не знает запрос ${name} — обновите страницу в Spotify → Веб-плеер`);
  return hash;
}

class PathfinderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly staleHash: boolean,
  ) {
    super(message);
  }
}

async function send(name: string, variables: Record<string, unknown>, hash: string): Promise<unknown> {
  const h = await spotifyWebHeaders();
  const res = await fetch(PATHFINDER, {
    method: 'POST',
    headers: { ...playerHeaders(h), 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      variables,
      operationName: name,
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    }),
  });
  const text = await res.text();
  let json: { data?: unknown; errors?: { message?: string }[] } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* не JSON — ниже сработает !res.ok */
  }
  const message = json?.errors?.map((e) => e.message).filter(Boolean).join('; ') ?? '';
  if (!res.ok) {
    throw new PathfinderError(message || `Spotify ${res.status}`, res.status, /PersistedQueryNotFound/i.test(text));
  }
  if (json?.errors?.length && json.data == null) {
    throw new PathfinderError(message || 'Spotify вернул ошибку', res.status, /PersistedQueryNotFound/i.test(message));
  }
  return json;
}

/** GET к spclient (радио и прочие сервисы плеера, которых нет в pathfinder). */
export async function spotifySpclient(path: string): Promise<unknown> {
  const run = async () => fetch(`${SPCLIENT}${path}`, { headers: playerHeaders(await spotifyWebHeaders()) });
  let res = await run();
  if (res.status === 401) {
    invalidateSpotifyWebHeaders();
    res = await run();
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'Spotify просит подождать — повторите через минуту' : `Spotify ${res.status}`);
  return res.json();
}

/** Запрос к каталогу Spotify от имени встроенного веб-плеера. */
export async function spotifyPathfinder(name: string, variables: Record<string, unknown>): Promise<unknown> {
  try {
    return await send(name, variables, await operationHash(name));
  } catch (e) {
    if (!(e instanceof PathfinderError)) throw e;
    if (e.status === 401) {
      invalidateSpotifyWebHeaders();
      return send(name, variables, await operationHash(name));
    }
    if (e.staleHash || e.status === 400 || e.status === 404) {
      return send(name, variables, await operationHash(name, true));
    }
    if (e.status === 429) throw new Error('Spotify просит подождать — повторите через минуту');
    throw e;
  }
}
