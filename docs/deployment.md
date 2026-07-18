# Deploy on Render

Create one Render Web Service from `ghcr.io/eastsun5566/vibelog-app:beta`. Leave Docker Command empty and set the health check path to `/health`.

## Domains

For `APP_ORIGIN=https://vibelog.eastsun.me`, attach both of these custom domains to the same Render service:

- `vibelog.eastsun.me` for the management app
- `*.vibelog.eastsun.me` for preview and published blogs

The app derives `preview.vibelog.eastsun.me` and `<username>.vibelog.eastsun.me`; there is no `PREVIEW_ORIGIN` setting. Point the root and wildcard DNS records requested by Render at the service. Render provisions TLS for configured custom domains.

## Required environment

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
DATA_ROOT=/data
APP_ORIGIN=https://vibelog.eastsun.me
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETA_INVITE_CODE=<openssl rand -base64 32>
VIBELOG_AI_PROVIDER=groq
VIBELOG_AI_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=...
VIBELOG_AI_USER_DAILY_LIMIT=20
VIBELOG_AI_GLOBAL_DAILY_LIMIT=200
```

Only configure the key for the selected pi-ai provider. Ollama may instead use `OLLAMA_BASE_URL` and does not require an API key.

Attach one persistent disk at `/data` for accounts, drafts, operations, and releases. VibeLog supports one service instance because SQLite and the local disk are not shared across instances. Version 0.5 requires an empty disk; startup rejects a pre-0.5 schema with a clear error.

An image-backed Render service does not automatically redeploy when the mutable `beta` tag changes. Choose **Deploy latest reference** or call a deploy hook after publishing a new image.
