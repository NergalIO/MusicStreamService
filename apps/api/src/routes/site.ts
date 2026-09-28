import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { fetchLatestReleaseDownloads } from '../lib/github-releases.js';

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
  const bootstrapPrefix = 'downloads';
  /** Legacy VPS-сборки в data/releases — отдельно от public/downloads (bootstrap). */
  const legacyPrefix = 'release-assets';

  app.get('/', async (_req, reply) => {
    const indexPath = path.join(config.publicDir, 'index.html');
    if (!fileExists(indexPath)) {
      return reply.code(404).send({ error: 'Landing not found' });
    }
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replaceAll('{{BASE_HREF}}', baseHref);
    html = html.replaceAll('{{BASE_PATH}}', config.basePath || '/');
    html = html.replaceAll('{{API_PUBLIC_URL}}', config.publicUrl);
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/site/downloads', async () => {
    const gh = await fetchLatestReleaseDownloads();
    const bootstrapCmd = `${bootstrapPrefix}/install-windows.cmd`;
    const bootstrapPs1 = `${bootstrapPrefix}/install-windows.ps1`;
    const hasBootstrap =
      fileExists(path.join(config.publicDir, 'downloads', 'install-windows.cmd')) ||
      fileExists(path.join(config.publicDir, 'downloads', 'install-windows.ps1'));

    const legacyWin = path.join(config.releasesDir, config.releaseFiles.windows);
    const legacyApk = path.join(config.releasesDir, config.releaseFiles.android);

    return {
      windowsBootstrap: {
        available: hasBootstrap,
        cmdHref: hasBootstrap ? bootstrapCmd : null,
        ps1Href: fileExists(path.join(config.publicDir, 'downloads', 'install-windows.ps1'))
          ? bootstrapPs1
          : null,
      },
      windowsExe: {
        available: Boolean(gh.windowsExeUrl) || fileExists(legacyWin),
        href:
          gh.windowsExeUrl ??
          (fileExists(legacyWin) ? `${legacyPrefix}/${config.releaseFiles.windows}` : null),
        fileName: config.releaseFiles.windows,
        source: gh.windowsExeUrl ? 'github' : fileExists(legacyWin) ? 'legacy' : null,
      },
      androidApk: {
        available: Boolean(gh.androidApkUrl) || fileExists(legacyApk),
        href:
          gh.androidApkUrl ??
          (fileExists(legacyApk) ? `${legacyPrefix}/${config.releaseFiles.android}` : null),
        fileName: config.releaseFiles.android,
        source: gh.androidApkUrl ? 'github' : fileExists(legacyApk) ? 'legacy' : null,
      },
      release: {
        tag: gh.tag,
        githubReleasePage: gh.githubReleasePage,
      },
    };
  });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    decorateReply: false,
    index: false,
  });

  await app.register(fastifyStatic, {
    root: config.releasesDir,
    prefix: `/${legacyPrefix}/`,
    decorateReply: false,
    index: false,
    setHeaders(reply, filePath) {
      const base = path.basename(filePath);
      if (base.endsWith('.exe') || base.endsWith('.apk')) {
        reply.header('Content-Disposition', `attachment; filename="${base}"`);
      }
    },
  });
}
