export interface Post {
  id: string
  title: string
  content: string
  slug: string
  date: string
}
export interface ContentResponse {
  posts: Post[];
  author: {
    name: string;
    bio: string;
  };
}

export interface ContentProvider {
  getContents(): Promise<ContentResponse>
}

export interface AiProvider {
  generate(prompt: string): Promise<string>
}
