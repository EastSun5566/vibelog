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
    console.log('Starting build preparation...');
    console.log(`Creating directory structure in ${this.root}`);

    await fs.ensureDir(this.root);
    await fs.ensureDir(join(this.root, 'src/content/blog'));
    await fs.ensureDir(join(this.root, 'src/pages'));
    await fs.ensureDir(join(this.root, 'src/styles'));
    await fs.ensureDir(join(this.root, 'src/layouts'));
    console.log('Directory structure created');

    await this.writeConfig();
    console.log('Content config written');

    await this.copyTemplates();
    console.log('Templates copied');

    await this.transformStyles();
    console.log('Styles transformed');
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
    const templatesDir = resolve(process.cwd(), 'template');
    console.log('Copying template from:', templatesDir);

    const files = {
      'global.css': 'src/styles/global.css',
      'base.astro': 'src/layouts/base.astro',
      'index.astro': 'src/pages/index.astro',
    };

    for (const [src, dest] of Object.entries(files)) {
      await fs.copyFile(
        join(templatesDir, src),
        join(this.root, dest),
      );
    }
  }


  private async transformStyles() {
    const cssPath = join(this.root, 'src/styles/global.css');
    const originalCss = await fs.readFile(cssPath, 'utf-8');
    const transformedCss = await this.transformer.transform(originalCss);
    await fs.writeFile(cssPath, transformedCss);
  }

  async build() {
    console.log('Starting build process...');

    try {
      console.log('Fetching content...');
      const contents = await this.contentProvider.getContents();
      console.log(`Found ${String(contents.length)} content items`);

      console.log('Writing content files...');
      for (const content of contents) {
        const filePath = join(this.root, 'src/content/blog', `${content.slug}.md`);
        await fs.writeFile(filePath, content.content);
      }

      console.log('Starting Astro build...');
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
    console.log('Starting cleanup...');
    await fs.remove(this.root);
    console.log('Cleanup completed');
  }
}
