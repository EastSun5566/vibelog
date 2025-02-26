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
  getPosts(): Promise<PostsResponse>
  getAuthor(): Promise<AuthorResponse>
}

export interface AiProvider {
  generate(prompt: string): Promise<string>
}
