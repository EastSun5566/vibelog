export interface Post {
  id: string
  title: string
  content: string
  slug: string
  date: string
}
export interface PostsResponse {
  posts: Post[];
}

export interface Author {
  name: string
  bio: string
}
export type AuthorResponse = Author

export interface ContentProvider {
  readonly name: string
  getPosts(): Promise<PostsResponse>
  getAuthor(): Promise<AuthorResponse>
}

export interface CssVariable {
  name: string;
  value: string;
}
export interface CssTransformResult {
  variables: CssVariable[];
  description: string;
}

export interface AiProvider {
  readonly name: string;
  readonly modelId: string;
  generate(prompt: string): Promise<CssTransformResult>
}
