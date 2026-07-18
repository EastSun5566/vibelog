import { defineConfig } from 'vitepress';

const TITLE = 'VibeLog';
const DESCRIPTION = 'Turn public HackMD writing into an AI-themed hosted Astro blog.';
const DOCS_URL = 'https://vibelog.eastsun.me';

const GA_ID = 'G-K826ZT9KZD';
const GA_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
const GA_SCRIPT = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_ID}');
`;

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: TITLE,
  description: DESCRIPTION,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: TITLE }],
    ['meta', { property: 'og:image', content: `${DOCS_URL}/logo.svg` }],
    ['meta', { property: 'og:url', content: DOCS_URL }],
    ['meta', { property: 'og:description', content: DESCRIPTION }],

    ['script', { async: 'true', src: GA_URL }],
    ['script', {}, GA_SCRIPT],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg',

    search: {
      provider: 'local',
    },

    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Deploy', link: '/deployment' },
    ],

    sidebar: [
      {
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Deploy', link: '/deployment' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/eastsun5566/vibelog' },
    ],

    footer: {
      copyright: 'Made with ❤️ By <a href="https://github.com/EastSun5566" target="_blank">@EastSun5566</a>',
    },
  },
});
