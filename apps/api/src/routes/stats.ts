import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  listeningEventsSchema,
  type HomeShelves,
  type ListeningHistory,
  type ListeningPeriod,
  type ListeningStats,
  type SourceId,
  type StatsTopArtist,
  type StatsTopTrack,
} from '@mss/shared';
import { db } from '../db/client.js';
import { listeningEvents } from '../db/schema.js';

const PERIOD_DAYS: Record<Exclude<ListeningPeriod, 'all'>, number> = { week: 7, month: 30, year: 365 };

function validTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

type Row = Record<string, unknown>;

async function rows<T extends Row>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (Array.isArray(result) ? result : (result as unknown as { rows: T[] }).rows) as T[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function isoTime(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function topTracksQuery(where: SQL, limit: number, having: SQL = sql`true`, order: SQL = sql`plays desc, minutes desc`): SQL {
  return sql`
    select source, track_id,
      (array_agg(title order by played_at desc))[1] as title,
      (array_agg(artist order by played_at desc))[1] as artist,
      (array_agg(artists order by played_at desc))[1] as artists,
      (array_agg(album order by played_at desc))[1] as album,
      (array_agg(album_id order by played_at desc))[1] as album_id,
      (array_agg(cover_url order by played_at desc) filter (where cover_url is not null))[1] as cover_url,
      max(duration_ms) as duration_ms,
      count(*)::int as plays,
      round(sum(played_ms) / 60000.0)::int as minutes,
      max(played_at) as last_played
    from ${listeningEvents}
    where ${where}
    group by source, track_id
    having ${having}
    order by ${order}
    limit ${limit}`;
}

function mapTrack(r: Row): StatsTopTrack {
  return {
    source: r.source as SourceId,
    trackId: String(r.track_id),
    title: String(r.title),
    artist: String(r.artist),
    artists: (r.artists as StatsTopTrack['artists']) ?? null,
    album: (r.album as string | null) ?? null,
    albumId: (r.album_id as string | null) ?? null,
    coverUrl: (r.cover_url as string | null) ?? null,
    durationMs: r.duration_ms === null ? null : num(r.duration_ms),
    plays: num(r.plays),
    minutes: num(r.minutes),
  };
}

/** Основной исполнитель: первый из списка ссылок, иначе первая часть строки «A, B». */
const artistName = sql`coalesce(nullif(artists->0->>'name', ''), trim(split_part(artist, ',', 1)))`;

function topArtistsQuery(where: SQL, limit: number): SQL {
  return sql`
    select (array_agg(${artistName} order by played_at desc))[1] as name,
      (array_agg(artists->0->>'id' order by played_at desc) filter (where artists->0->>'id' is not null))[1] as id,
      (array_agg(source order by played_at desc) filter (where artists->0->>'id' is not null))[1] as id_source,
      (array_agg(source order by played_at desc))[1] as source,
      (array_agg(cover_url order by played_at desc) filter (where cover_url is not null))[1] as cover_url,
      count(*)::int as plays,
      round(sum(played_ms) / 60000.0)::int as minutes
    from ${listeningEvents}
    where ${where}
    group by lower(${artistName})
    order by plays desc, minutes desc
    limit ${limit}`;
}

function mapArtist(r: Row): StatsTopArtist {
  return {
    name: String(r.name),
    id: (r.id as string | null) ?? null,
    source: ((r.id_source ?? r.source) as SourceId) ?? 'local',
    coverUrl: (r.cover_url as string | null) ?? null,
    plays: num(r.plays),
    minutes: num(r.minutes),
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.post('/me/plays', async (req) => {
    await app.authenticate(req);
    const { events } = listeningEventsSchema.parse(req.body);
    const now = Date.now();
    const values = events
      // Часы клиента могут врать: будущее и совсем старое прошлое не принимаем.
      .filter((e) => {
        const t = Date.parse(e.playedAt);
        return t <= now + 5 * 60_000 && t >= now - 3 * 365 * 86_400_000;
      })
      .map((e) => ({
        userId: req.userId!,
        clientEventId: e.clientEventId,
        source: e.source,
        trackId: e.trackId,
        title: e.title,
        artist: e.artist,
        artists: e.artists ?? null,
        album: e.album ?? null,
        albumId: e.albumId ?? null,
        coverUrl: e.coverUrl ?? null,
        durationMs: e.durationMs ?? null,
        playedMs: Math.min(e.playedMs, 6 * 3600_000),
        completed: e.completed,
        playedAt: new Date(e.playedAt),
      }));
    if (values.length) await db.insert(listeningEvents).values(values).onConflictDoNothing({ target: listeningEvents.clientEventId });
    return { ok: true, accepted: values.length };
  });

  app.get('/me/history', async (req): Promise<ListeningHistory> => {
    await app.authenticate(req);
    const list = await rows(sql`
      select source, track_id, title, artist, artists, album, album_id, cover_url, duration_ms, played_at
      from (
        select source, track_id, title, artist, artists, album, album_id, cover_url, duration_ms, played_at,
          row_number() over (partition by source, track_id order by played_at desc) as rn
        from ${listeningEvents}
        where user_id = ${req.userId!}
      ) recent
      where rn = 1
      order by played_at desc
      limit 200`);
    return {
      items: list.map((r) => ({
        source: r.source as SourceId,
        trackId: String(r.track_id),
        title: String(r.title),
        artist: String(r.artist),
        artists: (r.artists as ListeningHistory['items'][number]['artists']) ?? null,
        album: (r.album as string | null) ?? null,
        albumId: (r.album_id as string | null) ?? null,
        coverUrl: (r.cover_url as string | null) ?? null,
        durationMs: r.duration_ms == null ? null : num(r.duration_ms),
        playedAt: isoTime(r.played_at),
      })),
    };
  });

  app.get('/me/stats', async (req): Promise<ListeningStats> => {
    await app.authenticate(req);
    const q = req.query as { period?: string; year?: string; tz?: string };
    const tz = validTimeZone(q.tz);
    const year = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : undefined;
    const period: ListeningPeriod = year ? 'year' : q.period === 'week' || q.period === 'month' || q.period === 'year' ? q.period : 'all';

    const userFilter = sql`user_id = ${req.userId!}`;
    const range = year
      ? sql`(played_at at time zone ${tz}::text) >= make_date(${year}::int, 1, 1) and (played_at at time zone ${tz}::text) < make_date(${year + 1}::int, 1, 1)`
      : period === 'all'
        ? sql`true`
        : sql`played_at >= now() - make_interval(days => ${PERIOD_DAYS[period]}::int)`;
    const where = sql`${userFilter} and ${range}`;
    const unit: 'day' | 'month' = !year && (period === 'week' || period === 'month') ? 'day' : 'month';
    const bucketFormat = unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';

    const [totals, topTracks, topArtists, timeline, sources, hours] = await Promise.all([
      rows(sql`
        select coalesce(round(sum(played_ms) / 60000.0), 0)::int as minutes,
          count(*)::int as plays,
          count(distinct source || ':' || track_id)::int as tracks,
          count(distinct lower(${artistName}))::int as artists,
          count(distinct (played_at at time zone ${tz})::date)::int as days
        from ${listeningEvents} where ${where}`),
      rows(topTracksQuery(where, 50)),
      rows(topArtistsQuery(where, 30)),
      rows(sql`
        select to_char(played_at at time zone ${tz}, ${bucketFormat}) as bucket,
          round(sum(played_ms) / 60000.0)::int as minutes
        from ${listeningEvents} where ${where}
        group by 1 order by 1`),
      rows(sql`
        select source, round(sum(played_ms) / 60000.0)::int as minutes
        from ${listeningEvents} where ${where}
        group by source order by minutes desc`),
      rows(sql`
        select extract(hour from played_at at time zone ${tz})::int as hour, sum(played_ms) as ms
        from ${listeningEvents} where ${where}
        group by 1 order by ms desc limit 1`),
    ]);

    // Пустые дни тоже нужны графику, иначе столбики «слипаются».
    let series = timeline.map((r) => ({ bucket: String(r.bucket), minutes: num(r.minutes) }));
    if (unit === 'day') {
      const byDay = new Map(series.map((s) => [s.bucket, s.minutes]));
      const days = PERIOD_DAYS[period as 'week' | 'month'];
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      series = Array.from({ length: days }, (_, i) => {
        const bucket = fmt.format(new Date(Date.now() - (days - 1 - i) * 86_400_000));
        return { bucket, minutes: byDay.get(bucket) ?? 0 };
      });
    } else if (year) {
      const byMonth = new Map(series.map((s) => [s.bucket, s.minutes]));
      series = Array.from({ length: 12 }, (_, i) => {
        const bucket = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { bucket, minutes: byMonth.get(bucket) ?? 0 };
      });
    }

    const t = totals[0] ?? {};
    return {
      period,
      year,
      totalMinutes: num(t.minutes),
      totalPlays: num(t.plays),
      uniqueTracks: num(t.tracks),
      uniqueArtists: num(t.artists),
      activeDays: num(t.days),
      topTracks: topTracks.map(mapTrack),
      topArtists: topArtists.map(mapArtist),
      timeline: series,
      timelineUnit: unit,
      sources: sources.map((r) => ({ source: r.source as SourceId, minutes: num(r.minutes) })),
      peakHour: hours[0] ? num(hours[0].hour) : null,
    };
  });

  app.get('/me/shelves', async (req): Promise<HomeShelves> => {
    await app.authenticate(req);
    const user = sql`user_id = ${req.userId!}`;
    const [frequent, forgotten, artists] = await Promise.all([
      rows(topTracksQuery(sql`${user} and played_at >= now() - interval '30 days'`, 20, sql`count(*) >= 2`)),
      rows(
        topTracksQuery(
          user,
          20,
          sql`count(*) >= 3 and max(played_at) < now() - interval '45 days'`,
          sql`plays desc, last_played desc`,
        ),
      ),
      rows(topArtistsQuery(sql`${user} and played_at >= now() - interval '90 days'`, 12)),
    ]);
    return {
      frequent: frequent.map(mapTrack),
      forgotten: forgotten.map(mapTrack),
      topArtists: artists.map(mapArtist),
    };
  });
}
