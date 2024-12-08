import { Ollama } from 'ollama';
import * as cheerio from 'cheerio'

export class StyleTransformer implements StyleTransformer {
  private ai: Ollama
  private stylePrompt: string
  private model: string

  constructor(stylePrompt: string, model: string) {
    this.ai = new Ollama()
    this.model = model
    this.stylePrompt = stylePrompt
  }

  private analyzePageStructure($: cheerio.CheerioAPI) {
    return {
      layout: {
        hasNav: $('.VPNav').length > 0,
        hasSidebar: $('.VPSidebar').length > 0,
        hasFooter: $('.VPFooter').length > 0
      },
      content: {
        headings: $('h1, h2, h3').length,
        paragraphs: $('p').length,
        links: $('a').length
      },
      styles: {
        cssFiles: $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get(),
        inlineStyles: $('style').map((_, el) => $(el).html()).get()
      },
      theme: {
        isDark: $('html').hasClass('dark'),
        currentBrandColor: $(':root').css('--vp-c-brand-1')
      }
    }
  }

  async transform(html: string): Promise<string> {
    const $ = cheerio.load(html)
    const analysis = this.analyzePageStructure($)

    const response = await this.ai.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a web styling expert. Create CSS that enhances VitePress's default theme.
Focus on these aspects:
1. Use CSS variables for colors to maintain dark mode compatibility
2. Respect the existing layout structure
3. Enhance typography and spacing
4. Add subtle animations where appropriate
5. Ensure responsive design

IMPORTANT: Return only pure CSS code without any markdown code blocks or other formatting.
Do not include \`\`\`css or \`\`\` markers in your response.`
        },
        {
          role: "user",
          content: `Style guide: ${this.stylePrompt}

Page analysis:
${JSON.stringify(analysis, null, 2)}

Return format:
/* Theme customization */
:root {
  --vp-c-brand-1: #color;
  --vp-c-brand-2: #color;
  --vp-c-bg: #color;
  /* other variables */
}

/* Dark theme overrides */
.dark {
  --vp-c-bg: #color;
  /* dark theme variables */
}

/* Component styles */
.VPNav {
  /* navigation styles */
}

.vp-doc h1 {
  /* heading styles */
}

/* Add any necessary animations */
@keyframes fadeIn {
  /* animation definition */
}
`
        }
      ]
    })

    const css = response.message.content
      .replace(/```css/g, '')
      .replace(/```/g, '')
      .trim()
    $('head').append(`
      <style id="vide-custom-styles">
        /* Vide custom styles */
        ${css}
      </style>
    `)
    
    return $.html()
  }
}
