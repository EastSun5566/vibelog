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

| Provider | Format              | Description               |
| -------- | ------------------- | ------------------------- |
| `fs`     | `fs@<path>`         | Local file system content |
| `hackmd` | `hackmd@<username>` | HackMD public notes       |

#### AI Providers

| Provider     | Format               | Example                                 |
| ------------ | -------------------- | --------------------------------------- |
| `openai`     | `openai@<model>`     | `openai@gpt-4o-mini`                    |
| `anthropic`  | `anthropic@<model>`  | `anthropic@claude-3-haiku-20240307`     |
| `google`     | `google@<model>`     | `google@gemini-pro`                     |
| `ollama`     | `ollama@<model>`     | `ollama@llama2`                         |
| `openrouter` | `openrouter@<model>` | `openrouter@microsoft/wizardlm-2-8x22b` |

#### Dev Examples

```sh
# Basic usage with HackMD content
vibelog dev --content hackmd@eastsun5566 --ai openai@gpt-4o-mini

# Local content with custom port
vibelog dev --content fs@./my-content --port 3000

# Using Anthropic AI with local content
vibelog dev --content fs@./content --ai anthropic@claude-3-haiku-20240307

# Using Ollama (local AI) for offline development
vibelog dev --content fs@./content --ai ollama@llama2
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

## Workflow

1. **Development**: Use `vibelog dev` to preview content and experiment with styling
2. **Styling**: Use the web interface to apply AI-generated styles with natural language prompts
3. **Build**: Run `vibelog build` to generate production-ready static site
4. **Deploy**: Upload the `dist` directory to any static hosting service

## File Structure

After running `vibelog dev`, VibeLog creates a `.vibelog` directory in your project:

```text
.vibelog/
├── src/
│   ├── pages/
│   ├── components/
│   ├── layouts/
│   └── styles/
├── public/
├── astro.config.mjs
└── package.json
```

This directory contains the generated Astro project that serves as your blog.

## Error Handling

### Common Issues

1. **Missing API Key**: Ensure your AI provider's API key is set in environment variables
2. **Content Not Found**: Verify content source path/username exists
3. **Port in Use**: Use `-p` option to specify a different port
4. **Build Fails**: Ensure `vibelog dev` was run first to generate the project structure

## Tips

- Use `vibelog dev` in watch mode - it automatically updates when you modify content
- Experiment with different AI prompts for styling: try descriptive terms like "minimalist", "dark", "corporate", "playful"
- The development server includes hot reloading for instant feedback
- Always run `vibelog build` from the same directory where you ran `vibelog dev`
