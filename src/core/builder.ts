import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import fs from 'fs-extra';

import type { ContentProvider } from '../types';
import type { StyleTransformer } from './transformer';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SiteBuilderOptions {
  tempDir: string
  outDir: string
}

export class SiteBuilder {
  private root: string;
  private outDir: string;

  constructor(
    options: SiteBuilderOptions,
    private contentProvider: ContentProvider,
    private transformer: StyleTransformer,
  ) {
    this.root = resolve(process.cwd(), options.tempDir);
    this.outDir = resolve(process.cwd(), options.outDir);
  }

  async prepare() {
    await fs.ensureDir(this.root);
    await fs.ensureDir(join(this.root, 'src/content/blog'));
    await fs.ensureDir(join(this.root, 'src/pages'));
    await fs.ensureDir(join(this.root, 'src/styles'));
    await fs.ensureDir(join(this.root, 'src/layouts'));

    await this.writeConfig();
    await this.copyTemplates();

    await this.transformStyles();
  }

  private async writeConfig() {
    const contentConfigFile = join(this.root, 'src/content.config.ts');
    const contentConfigContent = `
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().optional(),
    date: z.string().optional(),
    slug: z.string().optional()
  })
});

export const collections = {
  blog
};
`;
    await fs.writeFile(contentConfigFile, contentConfigContent);
  }

  private async copyTemplates() {
    const templatesDir = resolve(__dirname, '../templates');

    await fs.copyFile(
      join(templatesDir, 'global.css'),
      join(this.root, 'src/styles/global.css'),
    );
    await fs.copyFile(
      join(templatesDir, 'base.astro'),
      join(this.root, 'src/layouts/base.astro'),
    );
    await fs.copyFile(
      join(templatesDir, 'index.astro'),
      join(this.root, 'src/pages/index.astro'),
    );
  }

  private async transformStyles() {
    const cssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(cssPath, 'utf-8');
    const transformedCss = await this.transformer.transform(originalCss);
    await fs.writeFile(cssPath, transformedCss);
  }

  async build() {
    try {
      const contents = await this.contentProvider.getContents();
      for (const content of contents) {
        const filePath = join(this.root, 'src/content/blog', `${content.slug}.md`);
        await fs.writeFile(filePath, content.content);
      }

      await build({
        root: this.root,
        outDir: this.outDir,
      });

      console.log('Build completed successfully!');
    } catch (error) {
      console.error('Build failed:', error);
      throw error;
    }
  }

  async cleanup() {
    await fs.remove(this.root);
  }
}
