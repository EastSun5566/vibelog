import { Ollama } from 'ollama';
import * as cheerio from 'cheerio'

export interface StyleTransformer {
  transform(html: string): Promise<string>
}

export class StyleTransformer implements StyleTransformer {
  private ai: Ollama
  private stylePrompt: string
  private model: string
  

  constructor(stylePrompt: string, model: string) {
    this.ai = new Ollama()
    this.model = model
    this.stylePrompt = stylePrompt
  }

  async transform(html: string): Promise<string> {
    const $ = cheerio.load(html)
    
    const elements = {
      // title: $('h1').text(),
      // content: $('.VPContent').html(),
      // navigation: $('.VPNav').html(),
      // sidebar: $('aside').html(),
      // footer: $('footer').html(),
      existingStyles: $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get(),
    }

    const response = await this.ai.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a web styling expert. The page already has default VitePress styles. 
Create CSS that will override the default styles to achieve the desired look.
Only return CSS code that specifically overrides or enhances the existing styles.
`
        },
        {
          role: "user",
          content: `Style guide: ${this.stylePrompt}

Existing styles: ${elements.existingStyles.join(', ')}

Return format example:
/* Override VitePress defaults */
:root {
  --vp-c-brand: #3451b2;
  --vp-c-brand-light: #3451b2;
}
.VPNav { /* custom styles */ }
.vp-doc h1 { /* custom styles */ }
`
        }
      ]
    })

    const css = response.message.content
    $('body').append(`<style id="vide-custom-styles">${css}</style>`)
    
    return $.html()
  }
}
