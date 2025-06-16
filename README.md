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

### Build prod-ready blog

```sh
# Build to `dist`
vibelog build --site-url https://your-blog.com
```

### Deploy

```sh
npx surge dist
```

## Commands

```sh
vibelog --help
vibelog dev --help
vibelog build --help
```

## Requirements

- Node.js v20+
