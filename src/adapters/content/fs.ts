import matter from 'gray-matter';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Content, ContentProvider } from '../../types';

export class FsProvider implements ContentProvider {
  constructor(private contentDir: string) {}

  async getContents(): Promise<Content[]> {
    try {
      const files = await readdir(this.contentDir);
      const mdFiles = files.filter(file => file.endsWith('.md'));

      const contents = mdFiles.map(file => {
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

      return contents;
    } catch (error) {
      console.error('Error reading content:', error);
      throw error;
    }
  }
}
