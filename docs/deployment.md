# Deploy on Render

Run one Web Service from `ghcr.io/eastsun5566/vibelog-app:beta`. Leave the Docker command empty, set the health check to `/health`, and attach one persistent disk at `/data`.

VibeLog supports one instance: SQLite and the local disk are not shared across instances.

## Domains

For `APP_ORIGIN=https://vibelog.example.com`, attach both domains to the service:

- `vibelog.example.com`
- `*.vibelog.example.com`

The wildcard serves `preview.vibelog.example.com` and each writer’s `<username>.vibelog.example.com` site.

## Environment

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
DATA_ROOT=/data
APP_ORIGIN=https://vibelog.example.com
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETA_INVITE_CODE=<openssl rand -base64 32>
VIBELOG_AI_PROVIDER=groq
VIBELOG_AI_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=...
VIBELOG_AI_USER_DAILY_LIMIT=20
VIBELOG_AI_GLOBAL_DAILY_LIMIT=200
```

Configure only the key for the selected AI provider. Ollama can use `OLLAMA_BASE_URL` without an API key.

Do not configure a guessed proxy header. Until Render’s exact edge header and trusted proxy chain are verified, VibeLog ignores forwarding headers and applies login/password limits per account plus a global registration limit.

## Backup and recovery

Create a consistent SQLite backup while the service is running:

```sh
node dist/backup.js
# Or choose an explicit new path:
node dist/backup.js /data/backups/staging-restore.sqlite
```

The command uses SQLite’s online backup API, refuses to overwrite a file, runs `PRAGMA integrity_check` on the copy, and prints the backup path as JSON.

Before a release, copy the backup off the service. On staging, restore it to an empty `/data/vibelog.sqlite`, start exactly one instance, then verify:

1. `PRAGMA integrity_check` returns `ok`.
2. `/health` returns `200`.
3. An existing username subdomain serves its active release.
4. Login, preview, and one sync complete successfully.

Render disk snapshots are a second layer of protection, not a replacement for this SQLite-aware backup and restore drill.

## Operations

The worker retries interrupted operations at most three times, prunes each blog to 20 releases, and removes recognized unreferenced artifacts at startup. Do not run a separate worker.

Generate the no-PII beta funnel report inside the production image:

```sh
node dist/beta-funnel.js
```

An image-backed Render service does not redeploy when a mutable tag changes. Use **Deploy latest reference** or a deploy hook after publishing a new image.
