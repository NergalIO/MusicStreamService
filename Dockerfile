# MusicStreamService — API + worker (monorepo)
FROM node:20-bookworm AS build

# pnpm@latest (v12+) блокирует postinstall без approve-builds — ломает esbuild в Docker build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY scripts/client-install scripts/client-install
COPY scripts/sync-client-downloads.cjs scripts/sync-client-downloads.cjs

RUN node scripts/sync-client-downloads.cjs
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 3001

CMD ["pnpm", "--filter", "@mss/api", "start"]
