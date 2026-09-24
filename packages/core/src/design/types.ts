import type { ThemeConfig } from '../types.js';
import type { BlogDesignSpecV2 } from './schema-v2.js';

export type DesignFont = ThemeConfig['bodyFont'];
export type DesignScale = ThemeConfig['scale'];
export type DesignContentWidth = ThemeConfig['contentWidth'];
export type DesignDensity = ThemeConfig['density'];
export type DesignRadius = ThemeConfig['radius'];

export interface ContentProfile {
  postCount: number;
  tagCount: number;
  averageLength: 'short' | 'medium' | 'long';
  codeUsage: 'none' | 'some' | 'frequent';
  imageUsage: 'none' | 'some' | 'frequent';
  mathUsage: 'none' | 'some' | 'frequent';
}

export type HomeSection =
  | { type: 'intro'; variant: 'minimal' | 'centered' | 'split'; showAuthor: boolean }
  | { type: 'featured-posts'; variant: 'hero' | 'split'; count: 1 | 2 }
  | { type: 'recent-posts'; variant: 'list' | 'cards' | 'grid'; limit: 3 | 5 | 6 | 9; columns?: 1 | 2 | 3 }
  | { type: 'topics'; variant: 'list' | 'cloud'; limit: 6 | 12 | 24 }
  | { type: 'author'; variant: 'compact' | 'profile' };

export type StyleTarget =
  | 'site.header'
  | 'home.intro'
  | 'home.sections'
  | 'posts.items'
  | 'article.header'
  | 'article.prose'
  | 'article.toc'
  | 'site.footer';

export interface StyleRule {
  target: StyleTarget;
  declarations: {
    textAlign?: 'start' | 'center';
    paddingBlock?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
    gap?: 'sm' | 'md' | 'lg' | 'xl';
    surface?: 'transparent' | 'background' | 'surface';
    border?: 'none' | 'hairline' | 'strong';
    width?: 'reading' | 'content' | 'full';
  };
}

export interface BlogDesignSpecV1 {
  version: 1;
  theme: {
    motif: 'minimal' | 'editorial' | 'notebook';
    appearance: 'light' | 'dark';
    colors: {
      background: string;
      surface: string;
      text: string;
      muted: string;
      accent: string;
      border: string;
    };
    typography: { bodyFont: DesignFont; headingFont: DesignFont; scale: DesignScale };
    layout: { contentWidth: DesignContentWidth; density: DesignDensity; radius: DesignRadius };
  };
  chrome: {
    header: { variant: 'compact' | 'centered' | 'masthead' };
    footer: { variant: 'minimal' | 'profile' };
  };
  pages: {
    home: { sections: HomeSection[] };
    index: {
      layout: 'list' | 'grid' | 'magazine';
      itemVariant: 'divided' | 'cards' | 'numbered';
      columns?: 1 | 2 | 3;
      showDescription: boolean;
      showTags: boolean;
    };
    article: {
      layout: 'reading' | 'wide' | 'with-aside';
      header: 'simple' | 'editorial';
      toc: 'auto-inline' | 'auto-aside' | 'hidden';
      metadata: 'compact' | 'detailed';
      navigation: 'links' | 'cards';
      codeBlock: 'plain' | 'panel';
    };
  };
  styles: { rules: StyleRule[] };
  description: string;
}

export type BlogDesignSpec = BlogDesignSpecV1;

export interface DesignProposalInput {
  blog: { title: string; description: string; author: string };
  contentProfile: ContentProfile;
  currentDesign: BlogDesignSpecV2;
  prompt: string;
}

export interface SourceSnapshotV1 {
  version: 1;
  site: { title: string; description: string; language: string };
  author: { name: string; bio: string };
  contentProfile: ContentProfile;
}
