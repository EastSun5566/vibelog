export interface Content {
  id: string
  title: string
  content: string
  slug: string
  date: string
}

export interface ContentProvider {
  getContents(): Promise<Content[]>
}

export interface AiProvider {
  generate(prompt: string): Promise<string>
}
