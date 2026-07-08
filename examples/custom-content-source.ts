// Example: Custom content source implementation
import type { ContentSource, PostsResponse, AuthorResponse } from '@vibelog/core';

export class DatabaseSource implements ContentSource {
  readonly name = 'database' as const;
  
  constructor(private databaseUrl: string) {}
  
  async getPosts(): Promise<PostsResponse> {
    // Fetch posts from your database
    const posts = await fetch(`${this.databaseUrl}/api/posts`)
      .then(r => r.json());
    
    return { posts };
  }
  
  async getAuthor(): Promise<AuthorResponse> {
    // Fetch author from your database
    const author = await fetch(`${this.databaseUrl}/api/author`)
      .then(r => r.json());
    
    return author;
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
