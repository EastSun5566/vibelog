# Getting Started

VibeLog transforms any content source into a production-ready blog with AI-powered styling. Get up and running in minutes.

## Prerequisites

- Node.js v20+
- AI provider API key (or use Ollama without API key)

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
vibelog build --site-url https://your-blog.com
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

### HackMD

Perfect for collaborative writing and public notes:

```sh
vibelog dev --content hackmd@<your_username>
```

For more content sources including local files and Ollama examples, see the Content Sources section below.

### File System

Use local markdown files:

```sh
vibelog dev --content fs@./my-content

# Or use Ollama for local AI without API key
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

## AI Providers

VibeLog supports multiple AI providers for styling:

```sh
# OpenAI
--ai openai@gpt-4o-mini

# Anthropic
--ai anthropic@claude-3-haiku-20240307

# Google
--ai google@gemini-pro

# Ollama (local, no API key needed)
--ai ollama@qwen2.5-coder:3b

# OpenRouter
--ai openrouter@microsoft/wizardlm-2-8x22b
```

## Next Steps

- [CLI Reference](/cli-reference) - Complete command reference
- [Content Structure](/content-structure) - Learn about content organization
- [Styling Guide](/styling-guide) - Advanced styling techniques
