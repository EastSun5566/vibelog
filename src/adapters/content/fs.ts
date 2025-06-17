import assert from 'node:assert/strict';
import { join } from 'node:path';
import matter from 'gray-matter';
import fs from 'fs-extra';

import { logger } from '../../core';
import { ContentSourceName } from '../../consts';
import type { ContentSource } from '../../types';

export class FsProvider implements ContentSource {
  readonly name = ContentSourceName.FS;
  constructor(readonly contentDir: string) {
    logger.info(`Content source: FS (${contentDir})`);

    assert(contentDir, 'Content directory is required. Use fs@<path-to-content-dir>');
  }

  async getPosts() {
    if (!await fs.exists(this.contentDir)) {
      throw new Error(`Content directory not found: ${this.contentDir}`);
    }
    const blogDir = join(this.contentDir, 'blog');
    if (!await fs.exists(blogDir)) {
      throw new Error(`Blog directory not found: ${blogDir}`);
    }

    const files = await fs.readdir(blogDir);
    const posts = files
      .filter(file => file.endsWith('.md'))
      .map(file => {
        const fullPath = join(blogDir, file);
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

  async getAuthor() {
    const authorPath = join(this.contentDir, 'author.md');
    if (!await fs.exists(authorPath)) {
      throw new Error(`Author profile not found: ${authorPath}`);
    }

    const { data, content } = matter.read(authorPath) as {
        data: Record<string, string>;
        content: string;
      };

    return {
      name: data.name || 'Unknown Author',
      bio: content.trim() || data.bio || '',
    };
  }
}
