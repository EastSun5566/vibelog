// Example: Custom content source implementation
import {
  ContentSourceName,
  type AuthorResponse,
  type ContentSource,
  type PostsResponse,
} from '@vibelog/core';

export class DatabaseSource implements ContentSource {
  readonly name = ContentSourceName.FS;

  constructor(private databaseUrl: string) {}

  async getPosts(): Promise<PostsResponse> {
    // Fetch posts from your database
    const posts: unknown = await fetch(`${this.databaseUrl}/api/posts`)
      .then((response) => response.json());
    if (!Array.isArray(posts)) throw new Error('Invalid posts response');

    return { posts: posts as PostsResponse['posts'] };
  }

  async getAuthor(): Promise<AuthorResponse> {
    // Fetch author from your database
    const author: unknown = await fetch(`${this.databaseUrl}/api/author`)
      .then((response) => response.json());
    if (!author || typeof author !== 'object' || !('name' in author) || !('bio' in author)) {
      throw new Error('Invalid author response');
    }

    return author as AuthorResponse;
  }
}

// Usage:
import { createDevBuilder } from '@vibelog/core';

const contentSource = new DatabaseSource('https://myapi.com');

const builder = createDevBuilder({
  root: './blog',
  contentSource,
});

await builder.prepare();
await builder.fetchContent();
