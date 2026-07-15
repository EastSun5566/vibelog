<img src="./logo.svg" width="180" alt="VibeLog Logo" />

# VibeLog

[![NPM Version](https://img.shields.io/npm/v/vibelog.svg?style=for-the-badge)](https://www.npmjs.com/package/vibelog)
[![NPM Downloads](https://img.shields.io/npm/dt/vibelog.svg?style=for-the-badge)](https://www.npmjs.com/package/vibelog)

> Bring your own content with some vibes

Transform any content source into a production-ready blog with AI-powered styling.

## Philosophy

- **Markdown as primitive** - Everything is markdown, including content & structure
- **Modify, don't generate** - Transform existing mature frameworks instead of generating UI from scratch
- **Pass the vibe check** - Good enough is perfect

## Quick Start

```sh
mkdir your-blog && cd your-blog
```

### Preview your content

```sh
export OPENAI_API_KEY=<your_openai_api_key>

# Start dev server
npx vibelog dev --content hackmd@<your_username> --ai openai@gpt-4o-mini

# Go to http://localhost:5566 and try prompts like: "dark theme with pink"
```

AI provider and model IDs come from the [pi-ai catalog](https://github.com/earendil-works/pi/tree/main/packages/ai). All built-in pi-ai providers are accepted; `ollama@<model>` also accepts any local model ID.

### Build prod-ready blog

```sh
# Build to `dist`
npx vibelog build --site-url https://your-blog.com
```

### Deploy

```sh
npx surge dist

# Or
npx vercel deploy dist

# Or
npx netlify deploy --dir=dist

# Or
npx wrangler pages deploy dist
```

## Other commands

```sh
vibelog --help
vibelog dev --help
vibelog build --help
```

## Requirements

- Node.js >=24.0.0

## Self-host the app

Copy `.env.example` to `.env`, fill the production settings, then start the web and worker processes on one shared SQLite volume:

```sh
docker compose up --build -d
```

The published image is `ghcr.io/eastsun5566/vibelog-app:beta`.
