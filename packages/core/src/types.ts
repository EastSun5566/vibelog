import { ContentSourceName } from './consts.js';

export interface VibelogConfig {
  site: {
    title?: string;
    description?: string;
    language?: string;
  };
}


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

export interface ContentSource {
  readonly name: ContentSourceName;
  getPosts(): Promise<PostsResponse>
  getAuthor(): Promise<AuthorResponse>
}

export type ThemePreset = 'minimal' | 'editorial' | 'notebook';
export type ThemeAppearance = 'light' | 'dark';
export type ThemeBodyFont = 'system-sans' | 'system-serif';
export type ThemeHeadingFont = ThemeBodyFont | 'system-mono';
export type ThemeScale = 'compact' | 'comfortable' | 'large';
export type ThemeContentWidth = 'narrow' | 'medium' | 'wide';
export type ThemeDensity = 'compact' | 'comfortable';
export type ThemeRadius = 'none' | 'soft' | 'round';
export type ThemeHeaderStyle = 'compact' | 'centered';
export type ThemePostListStyle = 'divided' | 'cards' | 'numbered';
export type ThemeCodeBlockStyle = 'plain' | 'panel';

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
}

export interface ThemeConfig {
  preset: ThemePreset;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  bodyFont: ThemeBodyFont;
  headingFont: ThemeHeadingFont;
  scale: ThemeScale;
  contentWidth: ThemeContentWidth;
  density: ThemeDensity;
  radius: ThemeRadius;
  headerStyle: ThemeHeaderStyle;
  postListStyle: ThemePostListStyle;
  codeBlockStyle: ThemeCodeBlockStyle;
  description: string;
}

export interface ThemeProposalInput {
  blog: { title: string; description: string; author: string };
  currentTheme: ThemeConfig;
  prompt: string;
}

export interface AiProvider {
  readonly name: string;
  readonly modelId: string;
  generate(input: ThemeProposalInput): Promise<ThemeConfig>
}
