<img src="./logo.svg" width="180" alt="VibeLog Logo" />

# VibeLog

> HackMD content → Astro blog → AI theme → VibeLog hosting

VibeLog turns a public HackMD profile into a complete hosted blog. Writers keep HackMD's mature publishing workflow; VibeLog builds the site, lets AI choose safe design tokens and curated layouts, and publishes it on a username subdomain.

## What 0.5 includes

- Invite-only username/password accounts
- One public HackMD source and one blog per account
- Editable blog identity and a clear summary of imported articles, HackMD tags, and modification dates
- A real Astro preview beside simple theme controls
- Immutable theme revisions for undo and redo
- Immutable publication history with one-click live rollback
- A reader-first homepage, reliable plain-text article summaries, complete archive, tag index and topic pages, adjacent-post navigation, RSS, sitemap, canonical URLs, Open Graph, responsive typography, and code styles
- One self-contained Node process with Hono, a SQLite operation worker, and hosted static releases

AI never writes arbitrary CSS or receives article bodies. It can only propose a validated theme schema; VibeLog checks allowed values and WCAG contrast before activating a revision.

## Run locally

```sh
cp .env.example .env
# Fill BETTER_AUTH_SECRET, BETA_INVITE_CODE, provider/model, and its API key.
pnpm dev
```

Generate local secrets with `openssl rand -base64 32`. Open `http://app.localtest.me:3000`; draft previews use `preview.app.localtest.me`, and published blogs use `<username>.app.localtest.me`. All `localtest.me` subdomains resolve to `127.0.0.1`, so no `/etc/hosts` changes are needed. Source-mode data stays in the ignored `.vibelog` directory.

To run the production container locally instead, use `docker compose -p vibelog05 up --build`. Compose overrides the runtime to production mode and stores data in its `/data` volume.

The published image is `ghcr.io/eastsun5566/vibelog-app:beta`. VibeLog 0.5 requires a fresh `/data` volume and intentionally does not migrate 0.4 beta data.

See [Getting Started](docs/getting-started.md) and the [deployment guide](packages/app/README.md).
