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

  private analyzeCss(css: string) {
    return {
      variables: {
        colors: css.match(/--vp-c-[^:]+:/g)?.map(v => v.slice(0, -1)),
        layout: css.match(/--vp-[^:]+:/g)?.filter(v => !v.startsWith('--vp-c-')).map(v => v.slice(0, -1))
      },
      components: {
        nav: css.includes('.VPNav'),
        sidebar: css.includes('.VPSidebar'),
        content: css.includes('.VPContent'),
        doc: css.includes('.vp-doc')
      },
      mediaQueries: css.match(/@media[^{]+\{/g),
      animations: css.match(/@keyframes[^{]+\{/g)
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
          content: `You are a CSS expert specializing in overriding and enhancing VitePress default styles.
Output ONLY valid CSS code that will override or enhance existing VitePress styles.
Focus on using VitePress's CSS variable system and component classes.
DO NOT include any explanations or comments.`
        },
        {
          role: "user",
          content: `Override and enhance VitePress styles with these requirements:
${this.stylePrompt}

Output format MUST be:
:root {
  --vp-c-brand-1: #newcolor;
  /* override other variables */
}

.dark {
  /* dark theme overrides */
}

/* enhance existing components */
.VPNav {
  /* override nav styles */
}

.vp-doc h1 {
  /* override heading styles */
}

/* add animations if needed */
@keyframes customAnim {
  /* animation definition */
}`
        }
      ]
    })

    const css = this.validateCSS(response.message.content)
    
    return `${originalCss}\n\n${css}`
  }
}
