# VibeLog

> Bring your own content with some vibes

Transform any content source into a production-ready blog with AI-powered styling.

## Philosophy

- **Markdown as infrastructure** - Everything is markdown including content & structure
- **Modify, don't generate** - Transform existing mature frameworks instead of generating UI from scratch
- **Pass the vibe check** - Good enough is perfect

## Installation

```bash
npm install -g vibelog
```

## Quick Start

```bash
mkdir my-blog && cd my-blog

# Start dev server with your content
vibelog dev --content hackmd@yourusername --ai ollama@qwen2.5-coder:3b

# Customize styles using the in-browser toolbar
# Try prompts like: "dark theme with purple accents" or "minimal design"

# Build production site
vibelog build --out dist --site https://yourblog.com
```

## Commands

```bash
vibelog --help
```

## Requirements

- Node.js v20+
- AI provider (e.g., Ollama)
