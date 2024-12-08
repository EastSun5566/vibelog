import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import fs from 'fs-extra'

import { build, type UserConfig, type DefaultTheme } from 'vitepress'
import { type StyleTransformer } from './transformer'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface BuilderOptions {
  tempDir: string
  outDir: string
}

class VitePressBuilder {
  root: string
  outDir: string

  constructor(options: BuilderOptions) {
    this.root = resolve(__dirname, options.tempDir)
    this.outDir = resolve(__dirname, options.outDir)
  }

  async prepare() {
    await fs.ensureDir(this.root)
    await fs.ensureDir(join(this.root, '.vitepress'))
  }

  async writeConfig(config: UserConfig<DefaultTheme.Config>) {
    const configFile = join(this.root, '.vitepress/config.ts')
    const configContent = `
import { defineConfig } from 'vitepress'

export default defineConfig({
  outDir: '${this.outDir}',
  ${Object.entries(config)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(',\n  ')}
})
`
    await fs.writeFile(configFile, configContent)
  }

  async writeContent(content: { path: string; content: string }[]) {
    await Promise.all(
      content.map(async (file) => {
        const filePath = join(this.root, file.path)
        await fs.ensureDir(dirname(filePath))
        await fs.writeFile(filePath, file.content)
      })
    )
  }

  async build() {
    try {
      await build(this.root)
      console.log('Build completed successfully!')
    } catch (error) {
      console.error('Build failed:', error)
      throw error
    }
  }

  async cleanup() {
    await fs.remove(this.root)
  }
}

export class Builder extends VitePressBuilder {
  private transformer: StyleTransformer

  constructor(options: BuilderOptions, transformer: StyleTransformer) {
    super(options)
    this.transformer = transformer
  }

  async transformStyles() {
    console.log('Starting style transformation...')
    
    const cssFiles = await glob(`${this.outDir}/assets/style.*.css`)
    if (cssFiles.length === 0) {
      throw new Error('Main style file not found')
    }

    const mainStyleFile = cssFiles[0]
    console.log(`Found main style file: ${mainStyleFile}`)

    const originalCss = await fs.readFile(mainStyleFile, 'utf-8')
    const transformedCss = await this.transformer.transform(originalCss)
    
    await fs.writeFile(mainStyleFile, transformedCss)
    console.log('Style transformation completed')
  }


  async build() {
    try {
      await super.build()

      await this.transformStyles()
      
      console.log('build and style transformation completed successfully!')
    } catch (error) {
      console.error('Build or transformation failed:', error)
      throw error
    }
  }
}