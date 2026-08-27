# VibeLog App

One Node.js process owns the Hono server, SQLite connection, and operation worker. The same image serves:

- `APP_ORIGIN`: authenticated management UI
- `preview.<APP_ORIGIN hostname>`: short-lived draft previews
- `<username>.<APP_ORIGIN hostname>`: immutable public releases

Auth cookies stay on the management host. Preview uses a separate short-lived token, and published sites are static and scriptless.

```sh
pnpm dev                         # source mode
docker compose up --build       # production shape
node dist/backup.js              # consistent SQLite backup
node dist/beta-funnel.js         # aggregate beta metrics, no PII
```

The only production entrypoint is `dist/main.js`. Runtime configuration is listed in [`.env.example`](../../.env.example).
