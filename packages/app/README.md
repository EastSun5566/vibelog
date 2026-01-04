# VibeLog SaaS API

A web API service for programmatic blog generation using VibeLog.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## API Endpoints

### Create Project

```bash
POST /api/projects
Content-Type: application/json

{
  "projectName": "my-blog",
  "contentSource": {
    "type": "fs",
    "handle": "./content"
  }
}
```

### Build Project

```bash
POST /api/projects/:projectId/build
Content-Type: application/json

{
  "siteUrl": "https://myblog.com"
}
```

### Transform Styles with AI

```bash
POST /api/projects/:projectId/style
Content-Type: application/json

{
  "prompt": "dark theme with neon purple accents",
  "aiProvider": {
    "type": "openai",
    "model": "gpt-4o-mini"
  }
}
```

## Environment Variables

```bash
# AI Provider API Keys
OPENAI_API_KEY=your-key
ANTHROPIC_API_KEY=your-key
GOOGLE_GENERATIVE_AI_API_KEY=your-key
OPENROUTER_API_KEY=your-key

# Server Configuration
PORT=3000
```

## Architecture

This SaaS package demonstrates how to use the `vibelog` core library programmatically:

- **vibelog**: Core library providing `DevBuilder`, `buildFromVibelog`, `StyleTransformer`, and adapters
- **fastify**: Web server framework for REST API
- **TypeScript**: Type-safe API development

## Example Usage

```typescript
import {
  createDevBuilder,
  createContentSource,
  ContentSourceName,
} from "vibelog";

const contentSource = createContentSource(ContentSourceName.FS, "./my-content");

const builder = createDevBuilder({
  root: "/path/to/project",
  contentSource,
  baseDir: "/",
});

await builder.prepare();
await builder.fetchContent();
```
