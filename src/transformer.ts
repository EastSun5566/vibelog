import { Ollama } from 'ollama';
// import * as cheerio from 'cheerio'

export class StyleTransformer implements StyleTransformer {
  private ai: Ollama
  private stylePrompt: string
  private model: string

  constructor(stylePrompt: string, model: string) {
    this.ai = new Ollama()
    this.model = model
    this.stylePrompt = stylePrompt
  }

  private extractVariables(css: string, prefix: string): Record<string, string> {
    const regex = new RegExp(`${prefix}[^:]+:\\s*([^;]+)`, 'g')
    const matches = [...css.matchAll(regex)]
    return Object.fromEntries(
      matches.map(match => [
        match[0].slice(prefix.length, -1),
        match[1].trim()
      ])
    )
  }

  private extractDarkVariables(css: string, prefix: string): Record<string, string> {
    const darkThemeRegex = /\.dark\s*{([^}]+)}/g
    const darkThemeMatches = [...css.matchAll(darkThemeRegex)]
    const darkCss = darkThemeMatches.map(match => match[1]).join('\n')
    return this.extractVariables(darkCss, prefix)
  }

  private analyzeCss(css: string) {
    return {
      colors: {
        brand: {
          light: this.extractVariables(css, '--vp-c-brand-'),
          dark: this.extractDarkVariables(css, '--vp-c-brand-')
        },
        background: {
          light: this.extractVariables(css, '--vp-c-bg'),
          dark: this.extractDarkVariables(css, '--vp-c-bg')
        },
        text: {
          light: this.extractVariables(css, '--vp-c-text-'),
          dark: this.extractDarkVariables(css, '--vp-c-text-')
        },
        functional: {
          tip: this.extractVariables(css, '--vp-c-tip-'),
          warning: this.extractVariables(css, '--vp-c-warning-'),
          danger: this.extractVariables(css, '--vp-c-danger-'),
          success: this.extractVariables(css, '--vp-c-success-')
        }
      },
      typography: {
        fonts: this.extractVariables(css, '--vp-font-family-'),
        code: {
          fontSize: this.extractVariables(css, '--vp-code-font-size'),
          lineHeight: this.extractVariables(css, '--vp-code-line-height')
        }
      },
      layout: {
        maxWidth: this.extractVariables(css, '--vp-layout-max-width'),
        nav: {
          height: this.extractVariables(css, '--vp-nav-height'),
          bgColor: this.extractVariables(css, '--vp-nav-bg-color')
        },
        sidebar: {
          width: this.extractVariables(css, '--vp-sidebar-width')
        }
      },
      components: {
        button: this.extractVariables(css, '--vp-button-'),
        customBlock: this.extractVariables(css, '--vp-custom-block-'),
        code: this.extractVariables(css, '--vp-code-'),
        badge: this.extractVariables(css, '--vp-badge-')
      },
      effects: {
        shadows: this.extractVariables(css, '--vp-shadow-'),
        zIndexes: this.extractVariables(css, '--vp-z-index-')
      }
    }
  }

  private validateCSS(css: string): string {
    css = css
      .replace(/```css/g, '')
      .replace(/```/g, '')
      .trim()
  
    if (!css.startsWith('/*') && !css.startsWith('.') && !css.startsWith(':')) {
      css = '/* Vide custom styles */\n' + css
    }
  
    const openBraces = (css.match(/{/g) || []).length
    const closeBraces = (css.match(/}/g) || []).length
    if (openBraces !== closeBraces) {
      console.warn('CSS syntax might be invalid: unmatched braces')
    }
  
    return css
  }
  

  async transform(originalCss: string): Promise<string> {
    const analysis = this.analyzeCss(originalCss)

    const response = await this.ai.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a CSS expert specializing in VitePress theming.
Your task is to generate comprehensive custom styles while maintaining VitePress's variable system.

Key areas to customize:
1. Color system (brand, backgrounds, text)
2. Typography (sizes, weights, line heights)
3. Component styles (nav, sidebar, content, buttons)
4. Layout and spacing
5. Animations and transitions
6. Interactive states (hover, active, focus)

Output ONLY valid CSS code that will override or enhance existing VitePress styles.
Focus on using VitePress's CSS variable system and component classes.
DO NOT include any explanations or comments.
`
        },
        {
          role: "user",
          content: `Style guide: ${this.stylePrompt}

Current theme analysis:
${JSON.stringify(analysis).slice(0, 1000)}

Return extensive CSS including:
1. Root variables (colors, typography, spacing)
2. Dark theme overrides
3. Component enhancements
4. Custom animations
5. Interactive states
6. Layout adjustments

Example format (but add more customizations):
:root {
  /* Brand colors */
  --vp-c-brand-1: #color;
  --vp-c-brand-2: #color;
  
  /* Background colors */
  --vp-c-bg: #color;
  
  /* Typography */
  --vp-font-family-base: font-stack;
  
  /* Custom variables */
  --custom-transition: 0.3s ease;
}

.dark {
  /* Dark theme colors */
}

/* Navigation */
.VPNav {
  /* Nav styles */
}

/* Sidebar */
.VPSidebar {
  /* Sidebar styles */
}

/* Content */
.vp-doc {
  /* Content styles */
}

/* Interactive states */
.VPButton:hover {
  /* Hover states */
}`
        }
      ]
    })

    const css = this.validateCSS(response.message.content)
    
    return `${originalCss}\n\n${css}`
  }
}
