import { Builder } from './builder';
import { StyleTransformer } from './transformer';


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