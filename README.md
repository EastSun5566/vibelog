<img src="./logo.svg" width="180" alt="VibeLog Logo" />

# VibeLog

> Keep writing in HackMD. Publish a fast, reliable blog without migrating your content.

VibeLog turns a public HackMD profile into a hosted Astro blog. Writers sync public articles, review a real static preview, and publish an immutable release on a username subdomain. Safe AI themes are optional.

The open beta provides:

- one HackMD source and one blog per account
- article selection, RSS, sitemap, tags, canonical metadata, and responsive static output
- safe preview, release-aware diffs, and rollback across the latest 20 releases
- one Node.js process with Hono, SQLite, and a local operation worker

AI receives only the blog identity, current theme, and design prompt. It never receives article bodies or writes arbitrary CSS.

## Run locally

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET, the AI provider/model, and its key.
pnpm install
pnpm dev
```

Open `http://app.localtest.me:3000`. Preview and published subdomains work through `localtest.me`, so no hosts-file changes are required.

Before opening a PR:

```sh
pnpm check
pnpm build
pnpm test:e2e
```

Writer instructions are available inside VibeLog at `/guide`.

## Deploy on Render

Run one Web Service from an immutable image such as `ghcr.io/eastsun5566/vibelog-app:0.6.0`. Leave the Docker command empty, use `/health` as the health check, and attach a persistent disk at `/data`. SQLite and the local disk are not shared, so VibeLog supports exactly one instance.

For `APP_ORIGIN=https://vibelog.example.com`, attach both `vibelog.example.com` and `*.vibelog.example.com` to the service. The wildcard serves the preview and writer subdomains.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
DATA_ROOT=/data
APP_ORIGIN=https://vibelog.example.com
BETTER_AUTH_SECRET=<openssl rand -base64 32>
VIBELOG_AI_PROVIDER=groq
VIBELOG_AI_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=...
VIBELOG_AI_USER_DAILY_LIMIT=20
VIBELOG_AI_GLOBAL_DAILY_LIMIT=200
```

Configure only the key for the selected AI provider. For OpenCode Go, use `VIBELOG_AI_PROVIDER=opencode-go`, a supported model such as `deepseek-v4-flash`, and `OPENCODE_API_KEY`. Ollama can use `OLLAMA_BASE_URL` without an API key.

Do not configure a guessed proxy header. VibeLog ignores forwarding headers until Render's trusted proxy chain is verified; login and password limits remain account-based, with a global registration limit.

## Backup and recovery

Create a consistent SQLite backup while the service is running:

```sh
node dist/backup.js
# Or choose a new path:
node dist/backup.js /data/backups/staging-restore.sqlite
```

The command uses SQLite's online backup API, refuses to overwrite a file, checks the copied database, and prints its path as JSON. Copy backups off the service. For a restore drill, restore into an empty `/data/vibelog.sqlite`, start one instance, then verify `PRAGMA integrity_check`, `/health`, one published subdomain, login, preview, and sync. Render snapshots are only a second layer of protection.

The built-in worker resumes interrupted operations up to three times, retains 20 releases per blog, and reconciles artifacts at startup. Do not run a separate worker. Generate the no-PII beta report with `node dist/beta-funnel.js`.

Image-backed Render services do not automatically redeploy a mutable tag. After publishing an image, deploy its exact version or use **Deploy latest reference**.
