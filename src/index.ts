import { Builder } from './builder'
import { StyleTransformer } from './transformer'

async function main() {
  const stylePrompt = `
    Create a modern, minimalist design with:
      - chill dark blue, relaxing green, and calming white colors
  `

  const transformer = new StyleTransformer(
    stylePrompt,
    'qwen2.5-coder:3b'
  )

  const builder = new Builder(
    {
      tempDir: '.temp',
      outDir: '../dist',
    },
    transformer
  )

  try {
    await builder.prepare()

    await builder.writeConfig({
      site: 'https://example.com',
      title: 'My Blog',
      description: 'A blog with AI-enhanced styling'
    })

    await builder.writeContent([
      {
        path: 'welcome.md',
        content: `---
title: Welcome to my blog
date: 2024-02-22
tags: ['intro']
---
# Welcome

This is my first blog post with AI-enhanced styling.
`
      },
      {
        path: 'about.md',
        content: `---
title: About
date: 2024-02-22
---
# About

This is my blog built with Astro and styled with AI.
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
