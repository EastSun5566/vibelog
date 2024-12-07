import fs from 'fs-extra'
import { glob } from 'glob';

import { type BuilderOptions, VitePressBuilder } from './builder';
import { LLMStyleTransformer, type StyleTransformer } from './transformer';

class Builder extends VitePressBuilder {
  private transformer: StyleTransformer

  constructor(options: BuilderOptions, transformer: StyleTransformer) {
    super(options)
    this.transformer = transformer
  }

  async transformBuiltFiles() {
    const htmlFiles = await glob(`${this.outDir}/**/*.html`)
    
    for (const file of htmlFiles) {
      const html = await fs.readFile(file, 'utf-8')
      const transformedHtml = await this.transformer.transform(html)
      await fs.writeFile(file, transformedHtml)
    }
  }

  async build() {
    try {
      await super.build()

      console.log('start transformation of built files...')
      await this.transformBuiltFiles()
      
      console.log('build and style transformation completed successfully!')
    } catch (error) {
      console.error('Build or transformation failed:', error)
      throw error
    }
  }
}


async function main() {
  const stylePrompt = `
    Create a modern, minimalist design with:
      - chill dark blue, relaxing green, and calming white colors
  `

  const transformer = new LLMStyleTransformer(
    stylePrompt,
    'qwen2.5-coder:3b'
  )

  const builder = new Builder(
    {
      tempDir: '.temp',
      outDir: '../dist',
      base: '/'
    },
    transformer
  )

  try {
    await builder.prepare()

    await builder.writeConfig({
      title: 'Vide Blog',
      description: 'A blog with AI-enhanced styling',
      themeConfig: {
        search: {
          provider: 'local'
        },
        nav: [
          { text: 'Home', link: '/' },
          { text: 'About', link: '/about' }
        ],
        sidebar: [
          { text: 'Home', link: '/' },
          { text: 'About', link: '/about' }
        ],
        socialLinks: [
          { icon: 'github', link: '' },
        ],
        footer: {
          message: 'Powered by VitePress and AI',
          copyright: ''
        }
      }
    })

    await builder.writeContent([
      {
        path: 'index.md',
        content: `---
title: Welcome to Vide
---
# Welcome to my AI-styled blog

This blog's style is enhanced by AI while maintaining its original content.
`
      },
      {
        path: 'about.md',
        content: `---
title: About Vide
---
# About Vide

This blog is built with VitePress and styled with AI.
`
      }
    ])

    await builder.build()
  } catch (error) {
    console.error('Failed:', error)
  } finally {
    await builder.cleanup()
  }
}

main().catch(console.error)