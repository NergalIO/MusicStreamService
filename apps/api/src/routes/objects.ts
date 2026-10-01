import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { verifyObjectAccess } from '../lib/object-access.js';
import { getObjectRange, headObject, putObjectStream } from '../lib/storage.js';

function queryFields(req: { query: unknown }): { bucket: string; key: string; exp?: string; sig?: string } {
  const q = req.query as Record<string, string | undefined>;
  return { bucket: q.bucket ?? '', key: q.key ?? '', exp: q.exp, sig: q.sig };
}

/** Локальный бэкенд: presigned URL указывает сюда, а не в S3. */
export async function objectRoutes(app: FastifyInstance) {
  app.addContentTypeParser('*', (_req, payload, done) => {
    done(null, payload);
  });

  app.put('/objects', async (req, reply) => {
    const { bucket, key, exp, sig } = queryFields(req);
    if (!bucket || !key || !verifyObjectAccess('PUT', bucket, key, exp, sig)) {
      return reply.code(403).send({ message: 'Недействительная ссылка загрузки' });
    }
    const body = req.body as Readable | undefined;
    if (!body) return reply.badRequest('Пустое тело');
    await putObjectStream(bucket, key, body);
    return reply.code(200).send({ ok: true });
  });

  app.get('/objects', async (req, reply) => {
    const { bucket, key, exp, sig } = queryFields(req);
    if (!bucket || !key || !verifyObjectAccess('GET', bucket, key, exp, sig)) {
      return reply.code(403).send({ message: 'Недействительная ссылка' });
    }
    const head = await headObject(bucket, key).catch(() => null);
    if (!head) return reply.notFound();
    const total = head.size;
    const range = req.headers.range;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', head.contentType ?? 'application/octet-stream');
    if (!range) {
      const { body, contentLength } = await getObjectRange(bucket, key, 0, Math.max(0, total - 1));
      reply.header('Content-Length', contentLength);
      return reply.send(Readable.from(body));
    }
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (!m) return reply.code(416).send();
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : total - 1;
    if (start >= total) return reply.code(416).send();
    const { body, contentLength } = await getObjectRange(bucket, key, start, end);
    reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${total}`)
      .header('Content-Length', contentLength);
    return reply.send(Readable.from(body));
  });
}
