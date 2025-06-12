import matter from 'gray-matter';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../../core';
import type { ContentProvider } from '../../types';

export class FsProvider implements ContentProvider {
  constructor(private contentDir: string) {
    logger.info(`Content provider: FS (${contentDir})`);
  }

  async getPosts() {
    const files = await readdir(this.contentDir);
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
