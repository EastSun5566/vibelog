# VibeLog SaaS app

Single-node Hono service for authenticated VibeLog projects. Production uses SQLite on a persistent `DATA_ROOT`, one web process, and one worker process.

## Runtime

- Node.js >=22.12.0
- OIDC Authorization Code + PKCE
- SQLite (`DATA_ROOT/vibelog.sqlite`)
- isolated preview origin
- Wrangler Direct Upload for Cloudflare Pages

Build and start the two processes:

```bash
pnpm --filter @vibelog/app build
pnpm --filter @vibelog/app start
pnpm --filter @vibelog/app start:worker
```

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

## API contract

All `/api/*` routes require the session cookie. Mutations also require the exact app `Origin` and the `X-CSRF-Token` returned by `GET /api/session`.

- `POST /api/projects` accepts `{ name, source }`, where `source` is `{ type: "hackmd", username }` or `{ type: "notion", databaseId, credentialId }`.
- `POST /api/projects/:id/{sync|build|style|deploy|delete}` returns `202 { jobId, status: "queued" }`.
- `GET /api/jobs/:jobId` returns persistent job state.
- `POST /api/credentials` stores Notion or Cloudflare credentials encrypted with AES-256-GCM.
- `GET /api/projects/:id/deployments` accepts credential metadata IDs, never API tokens.

Errors use `{ error: { code, message, requestId } }`. Responses never include credential values, absolute server paths, or stack traces.
