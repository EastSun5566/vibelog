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

Use `provider@modelId` with an exact provider and model from the [pi-ai catalog](https://github.com/earendil-works/pi/tree/main/packages/ai). VibeLog accepts every pi-ai built-in provider. `ollama@<modelId>` is the custom exception and accepts any model ID, using `OLLAMA_BASE_URL` or `http://localhost:11434/v1` by default.

#### Dev Examples

```sh
# Basic usage with HackMD content
vibelog dev --content hackmd@eastsun5566 --ai openai@gpt-4o-mini

# Local content with custom port
vibelog dev --content fs@./my-content --port 5566

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
- `GEMINI_API_KEY` - Google API key (canonical)
- `GOOGLE_GENERATIVE_AI_API_KEY` - Legacy Google fallback, used only when `GEMINI_API_KEY` is unset
- `OPENROUTER_API_KEY` - OpenRouter API key (for OpenRouter provider)
- `GROQ_API_KEY` - Groq API key (for Groq's hosted OpenAI-compatible API)
- `NVIDIA_API_KEY` - NVIDIA API key (for the hosted NVIDIA NIM API)
- `MISTRAL_API_KEY` - Mistral API key (for Mistral's hosted API)
- `XAI_API_KEY` - xAI API key (for xAI's hosted OpenAI-compatible API)
- `OLLAMA_BASE_URL` - Ollama OpenAI-compatible endpoint (default: `http://localhost:11434/v1`)

Other pi-ai providers use their documented environment variables or supported AWS/Google ambient credentials. VibeLog does not provide interactive OAuth login or store AI credentials.

### Required for Content Sources

- `NOTION_TOKEN` - Notion integration token (for Notion provider)

## Workflow

1. **Development**: Use `vibelog dev` to preview content and experiment with styling
2. **Styling**: Use the web interface to apply AI-generated styles with natural language prompts
3. **Build**: Run `vibelog build` to generate production-ready static site
4. **Deploy**: Upload the `dist` directory to any static hosting service
