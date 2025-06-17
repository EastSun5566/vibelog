import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "VibeLog",
  description: "Bring your own content with some vibes ✨",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'CLI Reference', link: '/cli-reference' }
    ],

    sidebar: [
      {
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Content Structure', link: '/content-structure' },
          { text: 'Styling Guide', link: '/styling-guide' },
          { text: 'CLI Reference', link: '/cli-reference' }
        ]
      }
    ],

    // socialLinks: [
    //   { icon: 'github', link: 'https://github.com/eastsun5566/vibelog' }
    // ]
  }
})
