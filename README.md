<img src="./logo.svg" width="180" alt="VibeLog Logo" />

# VibeLog

> HackMD content → Astro blog → AI theme → VibeLog hosting

VibeLog turns a public HackMD profile into a complete hosted blog. Writers keep HackMD's mature publishing workflow; VibeLog builds the site, lets AI choose safe design tokens and curated layouts, and publishes it on a username subdomain.

## What 0.5 includes

- Invite-only username/password accounts
- One public HackMD source and one blog per account
- A real Astro preview beside simple theme controls
- Immutable theme revisions for undo and redo
- RSS, sitemap, canonical URLs, Open Graph, responsive typography, and code styles
- One self-contained Node process with Hono, a SQLite operation worker, and hosted static releases

AI never writes arbitrary CSS or receives article bodies. It can only propose a validated theme schema; VibeLog checks allowed values and WCAG contrast before activating a revision.

## Run locally

```sh
cp .env.example .env
# Fill BETTER_AUTH_SECRET, BETA_INVITE_CODE, provider/model, and its API key.
docker compose up --build
```

Generate local secrets with `openssl rand -base64 32`. Open `http://localhost:3000`; draft previews use `preview.localhost`, and published blogs use `<username>.localhost`.

The published image is `ghcr.io/eastsun5566/vibelog-app:beta`. VibeLog 0.5 requires a fresh `/data` volume and intentionally does not migrate 0.4 beta data.

See [Getting Started](docs/getting-started.md) and the [deployment guide](packages/app/README.md).
