import { Ollama } from 'ollama';

export class StyleTransformer {
  private ai: Ollama
  private stylePrompt: string
  private model: string

  constructor(stylePrompt: string, model: string) {
    this.ai = new Ollama()
    this.model = model
    this.stylePrompt = stylePrompt
  }

  private validateCSS(css: string): string {
    css = css
      .replace(/```css/g, '')
      .replace(/```/g, '')
      .trim()
  
    const openBraces = (css.match(/{/g) || []).length
    const closeBraces = (css.match(/}/g) || []).length
    if (openBraces !== closeBraces) {
      console.warn('CSS syntax might be invalid: unmatched braces')
    }
  
    return css
  }

  async transform(originalCss: string): Promise<string> {
    const response = await this.ai.chat({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a CSS expert. Generate a clean, valid CSS theme.
Output ONLY valid CSS code.DO NOT include any explanations or comments.`
        },
        {
          role: "user",
          content: `Style guide: ${this.stylePrompt}

Original CSS:
${originalCss}

Modify the original CSS while maintaining its structure.
Use --theme- prefix for new variables.
Keep the existing styles and add:
1. Dark theme support
2. Enhanced colors
3. Simple animations
4. Interactive states
`
        }
      ]
    })

    return this.validateCSS(response.message.content)
  }
}
