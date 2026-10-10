<p align="center">
  <img src="./logo.svg" alt="VibeLog" width="72" height="72">
</p>

# VibeLog

VibeLog turns public HackMD articles into a searchable blog with RSS, a sitemap, llms.txt, and per-post Markdown. Keep writing in HackMD while AI shapes the site's look through a validated design specification. VibeLog builds the blog, and you decide when to publish.

## How it works

1. Connect a public HackMD profile.
2. Choose articles and review the private preview.
3. Publish an immutable release to a personal subdomain.

Content changes never update the live site until the writer publishes. Failed syncs keep the last working draft and release intact.

## Run locally

Requirements: Node.js 24, pnpm 10, Docker, and Chromium for Playwright.

```sh
cp .env.example .env
pnpm install
pnpm exec playwright install chromium
docker compose up --build
```

Open `http://app.localtest.me:3000`. Mailpit captures sign-in emails at `http://localhost:8025`.

Useful commands:

```sh
pnpm dev          # web process with direct background jobs
pnpm db:migrate   # apply local database migrations
pnpm check        # lint, typecheck, tests, and schema checks
pnpm test:e2e     # isolated Compose publish flow
```

## Architecture

The production image contains three Node.js entrypoints:

- `web-main.js` serves the management app, previews, and published artifacts.
- `worker-main.js` executes durable background operations.
- `migrate.js` applies checked-in PostgreSQL migrations before a release.

PostgreSQL is the source of truth. Static artifacts live in S3-compatible storage. The web process writes operations to a transactional outbox; a separate worker executes them safely under duplicate delivery.

The monorepo is split by responsibility:

| Package | Purpose |
| --- | --- |
| [`packages/core`](packages/core) | HackMD import and static Astro site builder |
| [`packages/app`](packages/app) | Web app, worker, database, and provider adapters |
| [`packages/edge`](packages/edge) | Cloudflare hostname routing and origin signing |
| [`packages/infra`](packages/infra) | Pulumi-managed production infrastructure |

## Deployment

Copy the agent setup prompt from [vibelog.org](https://vibelog.org) to let your coding agent build a private draft through [`@vibelog/cli`](packages/cli/README.md). Browser approval grants access for 12 hours. Login is draft-only by default; compatible CLI versions can request publishing access separately. Agents must wait for your explicit publish request and only share a live URL after publication succeeds.

Local development uses Compose. The cloud `prod` stack uses Neon PostgreSQL, Cloudflare R2 and Workers, GCP Cloud Run and Cloud Tasks, and Resend.

Production deploys are manual. The GitHub workflow checks the exact commit's CI result, runs a guarded Pulumi preview, then performs one `pulumi up`. See the [infrastructure guide](packages/infra/README.md) for normal operation and the [bootstrap runbook](packages/infra/RUNBOOK.md) for a new stack.

For a single VPS, [`compose.selfhost.yml`](compose.selfhost.yml) runs the released image with private PostgreSQL and MinIO services. Copy [`.env.selfhost.example`](.env.selfhost.example), replace every placeholder, and pin `VIBELOG_IMAGE` to an immutable version.

## License

[MIT](LICENSE)
