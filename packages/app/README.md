# VibeLog SaaS app

Single-node Hono service for authenticated VibeLog projects. The default runtime hosts the web app and job worker in one Node.js process backed by SQLite on `DATA_ROOT`.

## Runtime

- Node.js >=24.0.0
- OIDC Authorization Code + PKCE
- SQLite (`DATA_ROOT/vibelog.sqlite`)
- isolated preview origin
- Wrangler Direct Upload for Cloudflare Pages

Build and start the combined runtime:

```bash
pnpm --filter @vibelog/app build
pnpm --filter @vibelog/app start
```

Advanced deployments can still run `start:server` and `start:worker` as separate processes when they share the same data store.

Required production variables:

```dotenv
NODE_ENV=production
DATA_ROOT=/var/lib/vibelog
APP_ORIGIN=https://app.example.com
PREVIEW_ORIGIN=https://preview.example.com
APP_ENCRYPTION_KEY=<base64-encoded 32-byte key>
OIDC_ISSUER=https://issuer.example.com
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://app.example.com/auth/callback
VIBELOG_AI_PROVIDER=openai
VIBELOG_AI_MODEL=gpt-4o-mini
```

`APP_ALLOWED_ORIGINS` may contain a comma-separated explicit allowlist. It is empty by default; same-origin requests remain allowed.

AI provider and model IDs use the pi-ai catalog. Google uses `GEMINI_API_KEY`; `GOOGLE_GENERATIVE_AI_API_KEY` remains a legacy fallback. Groq uses `GROQ_API_KEY` with `https://api.groq.com/openai/v1`, hosted NVIDIA NIM uses `NVIDIA_API_KEY` with `https://integrate.api.nvidia.com/v1`, Mistral uses `MISTRAL_API_KEY` with `https://api.mistral.ai`, and xAI uses `XAI_API_KEY` with `https://api.x.ai/v1`. These providers support the tool-calling flow used by VibeLog ([Groq](https://console.groq.com/docs/tool-use/local-tool-calling), [NVIDIA NIM](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html), [Mistral](https://docs.mistral.ai/studio-api/conversations/function-calling), [xAI](https://docs.x.ai/developers/tools/function-calling)). Ollama accepts any model ID and uses `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`).

## Docker Compose

From the repository root, copy `.env.example` to `.env`, fill the required production variables, and run:

```bash
docker compose up --build -d
```

The single service uses `ghcr.io/eastsun5566/vibelog-app:beta`, runs the web app and worker together, and mounts a named volume at `/data`.

## Render demo

Create one Render Web Service from the existing image `ghcr.io/eastsun5566/vibelog-app:beta`. Leave Docker Command empty so the image starts the combined runtime, set the health check path to `/health`, and keep the instance count at one.

Set these runtime values in addition to the production variables above:

```dotenv
HOST=0.0.0.0
PORT=10000
DATA_ROOT=/data
```

To use a hosted AI provider, add one of these sets to the Render service:

```dotenv
# Groq
VIBELOG_AI_PROVIDER=groq
VIBELOG_AI_MODEL=openai/gpt-oss-20b
GROQ_API_KEY=...

# NVIDIA NIM
VIBELOG_AI_PROVIDER=nvidia
VIBELOG_AI_MODEL=nvidia/nemotron-3-super-120b-a12b
NVIDIA_API_KEY=...

# Mistral
VIBELOG_AI_PROVIDER=mistral
VIBELOG_AI_MODEL=devstral-medium-latest
MISTRAL_API_KEY=...

# xAI
VIBELOG_AI_PROVIDER=xai
VIBELOG_AI_MODEL=grok-code-fast-1
XAI_API_KEY=...
```

Set only the provider configuration you use. The fat container's built-in worker receives the same Render environment automatically.

Use the service's HTTPS URL for `APP_ORIGIN`, register `${APP_ORIGIN}/auth/callback` with the OIDC provider, and point a separate preview custom domain at the same Render service for `PREVIEW_ORIGIN`. Generate `APP_ENCRYPTION_KEY` once with `openssl rand -base64 32` and keep it stable.

The demo can use Render's ephemeral filesystem, in which case projects disappear after a redeploy or instance replacement. Attach a paid persistent disk at `/data` only when the demo needs durable data. A disk cannot be shared by separate Render services, which is why the default image runs the app and worker together. See [Render persistent disks](https://render.com/docs/disks).

Image-backed services do not redeploy automatically when the `beta` tag moves. After publishing, use **Manual Deploy → Deploy latest reference** or a deploy hook. See [Render image deployment](https://render.com/docs/deploying-an-image).

## API contract

All `/api/*` routes require the session cookie. Mutations also require the exact app `Origin` and the `X-CSRF-Token` returned by `GET /api/session`.

- `POST /api/projects` accepts `{ name, source }`, where `source` is `{ type: "hackmd", username }` or `{ type: "notion", databaseId, credentialId }`.
- `POST /api/projects/:id/{sync|build|style|deploy|delete}` returns `202 { jobId, status: "queued" }`.
- `GET /api/jobs/:jobId` returns persistent job state.
- `POST /api/credentials` stores Notion or Cloudflare credentials encrypted with AES-256-GCM.
- `GET /api/projects/:id/deployments` accepts credential metadata IDs, never API tokens.

Errors use `{ error: { code, message, requestId } }`. Responses never include credential values, absolute server paths, or stack traces.
