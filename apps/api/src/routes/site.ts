import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function siteRoutes(app: FastifyInstance) {
  fs.mkdirSync(config.releasesDir, { recursive: true });
  const baseHref = config.basePath ? `${config.basePath}/` : '/';

  app.get('/', async (_req, reply) => {
    const indexPath = path.join(config.publicDir, 'index.html');
    if (!fileExists(indexPath)) {
      return reply.code(404).send({ error: 'Landing not found' });
    }
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replaceAll('{{BASE_HREF}}', baseHref);
    html = html.replaceAll('{{BASE_PATH}}', config.basePath);
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/site/downloads', async () => {
    const winPath = path.join(config.releasesDir, config.releaseFiles.windows);
    const apkPath = path.join(config.releasesDir, config.releaseFiles.android);
    const dlPrefix = 'downloads';
    return {
      windows: {
        available: fileExists(winPath),
        href: `${dlPrefix}/${config.releaseFiles.windows}`,
        fileName: config.releaseFiles.windows,
      },
      android: {
        available: fileExists(apkPath),
        href: `${dlPrefix}/${config.releaseFiles.android}`,
        fileName: config.releaseFiles.android,
      },
    };
  });

  await app.register(fastifyStatic, {
    root: config.releasesDir,
    prefix: '/downloads/',
    decorateReply: false,
    index: false,
    setHeaders(reply, filePath) {
      const base = path.basename(filePath);
      if (base.endsWith('.exe') || base.endsWith('.apk')) {
        reply.header('Content-Disposition', `attachment; filename="${base}"`);
      }
    },
  });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    decorateReply: false,
    index: false,
  });
}
