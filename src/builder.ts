import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, type UserConfig, type DefaultTheme } from 'vitepress'
import fs from 'fs-extra'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface BuilderOptions {
  tempDir: string
  outDir: string
  base?: string
}

export class VitePressBuilder {
  root: string
  outDir: string
  base: string

  constructor(options: BuilderOptions) {
    this.root = resolve(__dirname, options.tempDir)
    this.outDir = resolve(__dirname, options.outDir)
    this.base = options.base || '/'
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
  base: '${this.base}',
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
      console.log('build completed successfully!')
    } catch (error) {
      console.error('build failed:', error)
      throw error
    }
  }

  async cleanup() {
    await fs.remove(this.root)
  }
}