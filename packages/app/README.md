# @vibelog/app

VibeLog App is a REST API server built with [Hono](https://hono.dev/), providing SaaS functionality for blog generation.

## Features

- ✨ **Ultra-fast**: Uses Hono framework, lightweight and high-performance
- 🚀 **REST API**: Complete project management API
- 🎨 **AI Style Transform**: Automatically adjust blog theme styles with AI
- 🔌 **Multi-source**: Support multiple content sources (File System, Notion, HackMD)

## Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **Runtime**: Node.js (via @hono/node-server)
- **Core**: @vibelog/core - VibeLog core functionality library

## Quick Start

```bash
# Install dependencies (from monorepo root)
pnpm install

# Start development server
pnpm --filter @vibelog/app dev

# Build for production
pnpm --filter @vibelog/app build

# Start production server
pnpm --filter @vibelog/app start
```

## API Endpoints

### List All Projects

```bash
GET /api/projects
```

**Response:**

```json
{
  "projects": [
    {
      "id": "my-blog",
      "name": "my-blog",
      "hasVibelog": true,
      "hasBuilt": true,
      "createdAt": "2026-01-05T12:00:00Z"
    }
  ]
}
```

### Get Project Details

```bash
GET /api/projects/:projectId
```

**Response:**

```json
{
  "id": "my-blog",
  "name": "my-blog",
  "paths": {
    "root": "/path/to/projects/my-blog",
    "vibelog": "/path/to/projects/my-blog/.vibelog",
    "dist": "/path/to/projects/my-blog/dist"
  },
  "status": {
    "hasVibelog": true,
    "hasBuilt": true,
    "canPreview": true
  },
  "stats": {
    "createdAt": "2026-01-05T12:00:00Z",
    "modifiedAt": "2026-01-05T13:00:00Z",
    "size": 1024
  }
}
```

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

**Response:**

```json
{
  "projectId": "my-blog",
  "status": "built",
  "outputDir": "/path/to/dist",
  "previewUrl": "http://localhost:3000/preview/my-blog/"
}
```

### Preview Project

```bash
GET /api/projects/:projectId/preview
```

**Response:**

```json
{
  "projectId": "my-blog",
  "previewUrl": "http://localhost:3000/preview/my-blog/",
  "status": "ready"
}
```

Visit the `previewUrl` in your browser to see the built site.

### Deploy to Cloudflare Pages

```bash
POST /api/projects/:projectId/deploy
Content-Type: application/json

{
  "cloudflare": {
    "accountId": "your-account-id",
    "apiToken": "your-api-token",
    "projectName": "my-vibelog-blog",
    "branch": "main"
  }
}
```

**Response:**

```json
{
  "projectId": "my-blog",
  "status": "deployed",
  "platform": "cloudflare",
  "deploymentUrl": "https://my-vibelog-blog.pages.dev",
  "deploymentId": "deployment-id",
  "environment": "production"
}
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment guide.

### Delete Project

```bash
DELETE /api/projects/:projectId
```

**Response:**

```json
{
  "projectId": "my-blog",
  "status": "deleted",
  "message": "Project 'my-blog' has been deleted successfully"
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
