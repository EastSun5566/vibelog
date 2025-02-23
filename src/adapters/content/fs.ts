import matter from 'gray-matter';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Content, ContentProvider } from '../../types';

export class FilesystemProvider implements ContentProvider {
  constructor(private contentDir: string) {}

  async getContents(): Promise<Content[]> {
    try {
      const files = await readdir(this.contentDir);
      const mdFiles = files.filter(file => file.endsWith('.md'));

      const contents = await Promise.all(
        mdFiles.map(async file => {
          const fullPath = join(this.contentDir, file);
          const rawContent = await readFile(fullPath, 'utf-8');

          const { data, content } = matter(rawContent);

          return {
            id: file.replace('.md', ''),
            title: data.title || 'Untitled',
            content: content,
            slug: data.slug || file.replace('.md', ''),
            date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
          };
        }),
      );

      return contents;
    } catch (error) {
      console.error('Error reading content:', error);
      throw error;
    }
  }
}
