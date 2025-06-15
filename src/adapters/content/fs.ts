import assert from 'node:assert/strict';
import { join } from 'node:path';
import matter from 'gray-matter';
import fs from 'fs-extra';

import { logger } from '../../core';
import { ContentProviderName } from '../../consts';
import type { ContentProvider } from '../../types';

export class FsProvider implements ContentProvider {
  readonly name = ContentProviderName.FS;
  constructor(readonly contentDir: string) {
    logger.info(`Content provider: FS (${contentDir})`);

    assert(contentDir, 'Content directory is required. Use fs@<path-to-content-dir>');
  }

  async getPosts() {
    if (!await fs.exists(this.contentDir)) {
      throw new Error(`Content directory not found: ${this.contentDir}`);
    }

    const files = await fs.readdir(this.contentDir);
    const mdFiles = files.filter(file => file.endsWith('.md'));

    const posts = mdFiles.map(file => {
      const fullPath = join(this.contentDir, file);
      const { data, content } = matter.read(fullPath) as {
          data: Record<string, string>;
          content: string;
        };

      return {
        id: file.replace('.md', ''),
        title: data.title,
        content: content,
        slug: data.slug || file.replace('.md', ''),
        date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      };
    });

    return {
      posts,
    };
  }

  getAuthor() {
    return Promise.resolve({
      name: 'My Name',
      bio: 'My bio',
    });
  }
}
