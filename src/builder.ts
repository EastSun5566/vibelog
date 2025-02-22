import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, dev } from 'astro'
import { glob } from 'glob'
import fs from 'fs-extra'
import type { StyleTransformer } from './transformer'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface BuilderOptions {
  tempDir: string
  outDir: string
}

export interface ContentFile {
  path: string
  content: string
}

class AstroBuilder {
  root: string
  outDir: string

  constructor(options: BuilderOptions) {
    this.root = resolve(__dirname, options.tempDir)
    this.outDir = resolve(__dirname, options.outDir)
  }

  async prepare() {
    await fs.ensureDir(this.root)
    await fs.ensureDir(join(this.root, 'src'))
    await fs.ensureDir(join(this.root, 'src/content'))
    await fs.ensureDir(join(this.root, 'src/pages'))
    await fs.ensureDir(join(this.root, 'src/styles'))

    const stylesDir = join(this.root, 'src/styles')
    await fs.writeFile(
      join(stylesDir, 'global.css'),
      `/* Base styles */
:root {
  --theme-bg: #ffffff;
  --theme-text: #111111;
}

body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 0;
  color: var(--theme-text);
  background: var(--theme-bg);
}

main {
  max-width: 70ch;
  margin: 0 auto;
  padding: 2rem;
}

nav {
  padding: 1rem;
  background: #f5f5f5;
}

nav a {
  margin-right: 1rem;
  color: inherit;
  text-decoration: none;
}
`)

    const layoutsDir = join(this.root, 'src/layouts')
    await fs.ensureDir(layoutsDir)

    const baseLayoutContent = `---
import '../styles/global.css'

const { title } = Astro.props
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
    <meta name="viewport" content="width=device-width" />
  </head>
  <body>
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
    </nav>
    <main>
      <slot />
    </main>
  </body>
</html>
`
    await fs.writeFile(join(layoutsDir, 'BaseLayout.astro'), baseLayoutContent)
  }

  async writeConfig(config: any) {
    const configFile = join(this.root, 'astro.config.mjs')
    const configContent = `
import { defineConfig } from 'astro/config'

export default defineConfig({
  outDir: '${this.outDir}',
  site: '${config.site || 'https://example.com'}',
  integrations: [],
  markdown: {
    shikiConfig: {
      theme: 'dracula'
    }
  }
})
`
    await fs.writeFile(configFile, configContent)

    const contentConfigFile = join(this.root, 'src/content/config.ts')
    const contentConfigContent = `
import { defineCollection, z } from 'astro:content'

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date().optional(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
  })
})

export const collections = {
  'blog': blog
}
`
    await fs.writeFile(contentConfigFile, contentConfigContent)
  }

  async writeContent(content: ContentFile[]) {
    await Promise.all(
      content.map(async (file) => {
        const filePath = join(this.root, 'src/content/blog', file.path)
        await fs.ensureDir(dirname(filePath))
        await fs.writeFile(filePath, file.content)
      })
    )

    const indexPage = join(this.root, 'src/pages/index.astro')
    const indexContent = `---
import { getCollection } from 'astro:content'
import BaseLayout from '../layouts/BaseLayout.astro'

const posts = await getCollection('blog')
---

<BaseLayout title="Blog">
  <h1>Welcome to my blog</h1>
  <ul>
    {posts.map(post => (
      <li>
        <a href={'/blog/' + post.slug}>{post.data.title}</a>
      </li>
    ))}
  </ul>
</BaseLayout>
`
    await fs.writeFile(indexPage, indexContent)
  }

  async build() {
    try {
      await build({
        root: this.root,
        outDir: this.outDir
      })
      console.log('Build completed successfully!')
    } catch (error) {
      console.error('Build failed:', error)
      throw error
    }
  }

  async dev() {
    try {
      const server = await dev({
        root: this.root,
      })
      return server
    } catch (error) {
      console.error('Dev server failed:', error)
      throw error
    }
  }

  async cleanup() {
    await fs.remove(this.root)
  }
}

export class Builder extends AstroBuilder {
  private transformer: StyleTransformer

  constructor(options: BuilderOptions, transformer: StyleTransformer) {
    super(options)
    this.transformer = transformer
  }

  async prepare() {
    await super.prepare();
    await this.transformStyles();
  }

  async transformStyles() {
    console.log('Starting style transformation...')
    
    const globalCssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(globalCssPath, 'utf-8');
    
    const transformedCss = await this.transformer.transform(originalCss);
    await fs.writeFile(globalCssPath, transformedCss);

    console.log('Style transformation completed')
  }

  async build() {
    try {
      await super.build()
      console.log('Build and style transformation completed successfully!')
    } catch (error) {
      console.error('Build or transformation failed:', error)
      throw error
    }
  }
}
