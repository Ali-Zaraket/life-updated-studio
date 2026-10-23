# One image for the studio, the worker and the one-off tools (see compose.yaml).
FROM node:22-bookworm-slim

# ffmpeg for media checks and delivery encodes; the libraries Remotion's headless browser needs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
      libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
 && rm -rf /var/lib/apt/lists/*

# Downloads retry with long timeouts so a slow or flaky connection does not fail the build.
# (Everything above this line is kept unchanged so existing build caches stay valid.)
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=180000 \
    npm_config_fetch_timeout=600000
# pnpm through npm, which retries; corepack gives up on the first network error.
RUN npm install -g pnpm@10.14.0

WORKDIR /app
RUN chown node:node /app
USER node

# Dependencies first so source edits do not reinstall them.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/studio/package.json apps/studio/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node packages/contracts/package.json packages/contracts/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node packages/content/package.json packages/content/
COPY --chown=node:node packages/media/package.json packages/media/
COPY --chown=node:node packages/instagram/package.json packages/instagram/
COPY --chown=node:node packages/reasoning/package.json packages/reasoning/
COPY --chown=node:node packages/render/package.json packages/render/
RUN pnpm install --frozen-lockfile --network-concurrency 4

# Remotion's headless browser, downloaded once at build time. Remotion keeps it under the
# nearest package.json's node_modules/.remotion, so fetch it from /app where renders run.
RUN for attempt in 1 2 3 4; do \
      node -e "require(require.resolve('@remotion/renderer', { paths: ['packages/render'] })).ensureBrowser().then(() => console.log('remotion browser ready'))" && exit 0; \
      echo "browser download failed (attempt $attempt), retrying in 20s"; sleep 20; \
    done; exit 1

COPY --chown=node:node . .
RUN pnpm --filter @life/studio build

# Data and secrets are mounted at run time, never baked in.
RUN mkdir -p storage auditions backups secrets/public
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/life-entrypoint
USER root
ENTRYPOINT ["life-entrypoint"]
EXPOSE 3100
CMD ["pnpm", "--filter", "@life/studio", "start", "--hostname", "0.0.0.0"]
