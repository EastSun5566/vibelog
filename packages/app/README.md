# VibeLog App

The app is one Node.js process containing the Hono server and SQLite-backed operation worker. It hosts three isolated surfaces from one image:

- `APP_ORIGIN`: authenticated management editor
- `preview.<APP_ORIGIN hostname>`: short-lived draft preview
- `<username>.<APP_ORIGIN hostname>`: public immutable release

Auth cookies are host-only and are never sent to preview or user blogs. Preview uses a separate short-lived token cookie. Published content is scriptless and receives a restrictive CSP.

Each successful HackMD sync builds a versioned draft directory and switches the SQLite pointer only after the build is complete. Failed syncs therefore leave the previous blog identity, article summary, draft, and public release untouched.

## Runtime

```sh
docker compose up --build
```

The container runs as the non-root `node` user, stores all durable state below `/data`, responds at `/health`, and gracefully stops HTTP and the current operation on SIGTERM.

Required auth configuration is only `BETTER_AUTH_SECRET` and `BETA_INVITE_CODE`; neither is a user password. The beta code gates registration, while each writer chooses their own username and password. There is no email, CAPTCHA, external auth key, or password recovery.

See [the Render deployment guide](../../docs/deployment.md) for domains and environment variables.
