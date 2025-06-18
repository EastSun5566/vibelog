# CLI Reference

Complete reference for the VibeLog command-line interface.

## Global Options

```sh
vibelog [options] <command>
```

### Options

- `-r, --root <dir>` - Project root directory (default: `.`)
- `-h, --help` - Display help information
- `-V, --version` - Display version number

## Commands

### `vibelog dev`

Start development server with content preview and AI-powered styling capabilities.

```sh
vibelog dev [options]
```

#### Dev Options

- `-c, --content <provider>` - Content source info (default: `fs@./content`)
- `--ai <provider>` - AI provider info (default: `openai@gpt-4o-mini`)
- `-p, --port <port>` - Development server port (default: `5566`)

#### Content Sources

| Provider | Format                 | Description               |
| -------- | ---------------------- | ------------------------- |
| `fs`     | `fs@<path>`            | Local file system content |
| `hackmd` | `hackmd@<username>`    | HackMD public notes       |
| `notion` | `notion@<database_id>` | Notion database pages     |

#### AI Providers

| Provider     | Format               | Example                                       |
| ------------ | -------------------- | --------------------------------------------- |
| `openai`     | `openai@<model>`     | `openai@gpt-4o-mini`                          |
| `anthropic`  | `anthropic@<model>`  | `anthropic@claude-3-5-haiku-20241022`         |
| `google`     | `google@<model>`     | `google@gemini-2.5-flash`                     |
| `ollama`     | `ollama@<model>`     | `ollama@qwen2.5-coder:3b`                     |
| `openrouter` | `openrouter@<model>` | `openrouter@deepseek/deepseek-r1-0528:free｀` |

#### Dev Examples

```sh
# Basic usage with HackMD content
vibelog dev --content hackmd@eastsun5566 --ai openai@gpt-4o-mini

# Local content with custom port
vibelog dev --content fs@./my-content --port 3000

# Using Notion database as content source
vibelog dev --content notion@abc123def456 --ai openai@gpt-4o-mini

# Using Anthropic AI with local content
vibelog dev --content fs@./content --ai anthropic@claude-3-haiku-20240307

# Using Ollama (local AI) for offline development
vibelog dev --content fs@./content --ai ollama@qwen2.5-coder:3b
```

### `vibelog build`

Build production site from development state.

```sh
vibelog build [options]
```

#### Build Options

- `-d, --out-dir <dir>` - Output directory (default: `dist`)
- `--site-url <url>` - Site URL for sitemap generation (default: `https://example.com`)

#### Build Examples

```sh
# Basic build
vibelog build

# Custom output directory and site URL
vibelog build --out-dir public --site-url https://myblog.com

# Build from specific project root
vibelog build --root ./my-project --site-url https://my-project.netlify.app
```

## Environment Variables

### Required for AI Features

- `OPENAI_API_KEY` - OpenAI API key (for OpenAI provider)
- `ANTHROPIC_API_KEY` - Anthropic API key (for Anthropic provider)
- `GOOGLE_GENERATIVE_AI_API_KEY` - Google API key (for Google provider)
- `OPENROUTER_API_KEY` - OpenRouter API key (for OpenRouter provider)

### Required for Content Sources

- `NOTION_TOKEN` - Notion integration token (for Notion provider)

## Workflow

1. **Development**: Use `vibelog dev` to preview content and experiment with styling
2. **Styling**: Use the web interface to apply AI-generated styles with natural language prompts
3. **Build**: Run `vibelog build` to generate production-ready static site
4. **Deploy**: Upload the `dist` directory to any static hosting service
