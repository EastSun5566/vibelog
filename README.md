# VibeLog

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
# Start dev server
export OPENAI_API_KEY=<your_openai_api_key>
npx vibelog dev --content hackmd@<yourusername> --ai openai@gpt-4o-mini

# Go to http://localhost:5566 and try prompts like: "dark theme with pink"
```

### Build prod-ready blog

```sh
# Build to `dist`
vibelog build --site-url https://your-blog.com
```

## Ship it

```sh
npx surge dist
```

## Commands

```sh
vibelog --help
```

## Requirements

- Node.js v20+
