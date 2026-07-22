# syntax=docker/dockerfile:1

FROM node:24-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/app/package.json ./packages/app/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --filter @vibelog/app... --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build

COPY . .

RUN pnpm --filter @vibelog/core build \
  && pnpm --filter @vibelog/app build \
  && pnpm --filter @vibelog/app deploy --prod /runtime

FROM node:24-slim AS runtime

LABEL org.opencontainers.image.title="VibeLog App"
LABEL org.opencontainers.image.description="Hosted HackMD-to-Astro AI theme editor"
LABEL org.opencontainers.image.source="https://github.com/EastSun5566/vibelog"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_ROOT=/data

RUN mkdir /data && chown node:node /data

COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node --from=build /runtime ./

USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
