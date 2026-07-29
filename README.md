<img src="./logo.svg" width="180" alt="VibeLog Logo" />

# VibeLog

> Keep writing in HackMD. Publish a fast, reliable blog without migrating your content.

VibeLog turns a public HackMD profile into a hosted Astro blog. Writers sync public articles, review a real static preview, and publish an immutable release on a username subdomain. Safe AI themes are optional.

The invite-only beta provides:

- one HackMD source and one blog per account
- article selection, RSS, sitemap, tags, canonical metadata, and responsive static output
- safe preview, release-aware diffs, and rollback across the latest 20 releases
- one Node.js process with Hono, SQLite, and a local operation worker

AI receives only the blog identity, current theme, and design prompt. It never receives article bodies or writes arbitrary CSS.

## Run locally

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET, BETA_INVITE_CODE, the AI provider/model, and its key.
pnpm install
pnpm dev
```

Open `http://app.localtest.me:3000`. Preview and published subdomains work through `localtest.me`, so no hosts-file changes are required.

Before opening a PR:

```sh
pnpm check
pnpm build
pnpm docs:build
pnpm test:e2e
```

Writer instructions live in [Getting Started](docs/getting-started.md). Production configuration, backup, and recovery live in [Deployment](docs/deployment.md).
