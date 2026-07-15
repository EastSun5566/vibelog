# Getting Started

VibeLog transforms any content source into a production-ready blog with AI-powered styling. Get up and running in minutes.

<div style="width: 100%; aspect-ratio: 16 / 9;">
  <iframe width="100%" height="100%" src="https://www.youtube.com/embed/ojKU4krO5CE" title="Introducing VibeLog" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

## Prerequisites

- Node.js >=24.0.0
- AI provider API key (or use [Ollama](https://ollama.com/) without API key)

## Quick Start

### 1. Create Your Blog Directory

```sh
mkdir your-blog && cd your-blog
```

### 2. Preview Your Content

Start the development server to preview your content and experiment with AI-powered styling:

```sh
# Set your OpenAI API key
export OPENAI_API_KEY=<your_openai_api_key>

# Start dev server with HackMD content
npx vibelog dev --content hackmd@<your_username> --ai openai@gpt-4o-mini
```

Navigate to `http://localhost:5566` and use the vibelog panel to modify styles with AI prompts like:

- "dark theme with pink accents"
- "minimal design with green colors"
- "corporate blue theme"

### 3. Build Production Site

Once you're happy with your design, build the production-ready site:

```sh
npx vibelog build --site-url https://your-blog.com
```

This generates a static site in the `dist` directory.

### 4. Deploy

Deploy your site using any static hosting service:

```sh
# Example with Surge
npx surge dist

# Or with Vercel
npx vercel dist

# Or with Netlify
npx netlify deploy --prod --dir dist
```

## Content Sources

VibeLog supports multiple content sources:

### File System

Use local markdown files:

```sh
vibelog dev --content fs@./my-content --ai ollama@qwen2.5-coder:3b
```

Your content directory should have this structure:

```text
my-content/
├── blog/
│   ├── post1.md
│   ├── post2.md
│   └── post3.md
└── author.md
```

### HackMD

Turn your [HackMD](https://hackmd.io/) workspace public notes into a blog:

```sh
vibelog dev --content hackmd@<your_username> --ai anthropic@claude-3-5-haiku-20241022
```

### Notion

Transform your [Notion](https://www.notion.com/) database pages into a blog:

```sh
# Set your Notion integration token
export NOTION_TOKEN=<your_notion_token>

# Use Notion database as content source
vibelog dev --content notion@<database_id> --ai openai@gpt-4o-mini
```

**Note**: Make sure your Notion integration has access to the database and the database ID is correct. VibeLog will provide helpful error messages if there are authentication or permission issues.

---

> [!NOTE]
> More content sources will be supported in the future

## AI Providers

VibeLog accepts every built-in provider and model in the [pi-ai catalog](https://github.com/earendil-works/pi/tree/main/packages/ai). Use the exact `provider@modelId` pair from that catalog. Authentication is non-interactive and uses provider environment variables or supported AWS/Google ambient credentials.

```sh
# OpenAI
export OPENAI_API_KEY=<your_openai_api_key>
--ai openai@gpt-4o-mini

# Anthropic
export ANTHROPIC_API_KEY=<your_anthropic_api_key>
--ai anthropic@claude-3-5-haiku-20241022

# Google
export GEMINI_API_KEY=<your_google_api_key>
--ai google@gemini-2.5-flash

# OpenRouter
export OPENROUTER_API_KEY=<your_openrouter_api_key>
--ai openrouter@qwen/qwen-2.5-coder-32b-instruct:free

# Ollama (local, no API key needed)
export OLLAMA_BASE_URL=http://localhost:11434/v1
--ai ollama@qwen2.5-coder:3b
```

`GOOGLE_GENERATIVE_AI_API_KEY` remains accepted as a legacy, request-scoped fallback when `GEMINI_API_KEY` is not set. OAuth-only providers require credentials already available to pi-ai; VibeLog does not add interactive login or credential storage.

## Next Steps

- [CLI Reference](/cli-reference) - Complete command reference
- [Content Structure](/content-structure) - Learn about content organization
- [Styling Guide](/styling-guide) - Advanced styling techniques
