import value from './generated/design.json';

export type Presentation = {
  emphasis?: 'subtle' | 'normal' | 'strong';
  width?: 'reading' | 'content' | 'full';
  align?: 'start' | 'center';
  surface?: 'plain' | 'soft' | 'prominent';
  density?: 'compact' | 'comfortable' | 'relaxed';
  spacing?: 'none' | 'tight' | 'normal' | 'relaxed' | 'spacious';
  frame?: 'none' | 'subtle' | 'strong';
};

export type HomeSectionV2 =
  | { type: 'intro'; variant: 'minimal' | 'centered' | 'split'; showAuthor: boolean; presentation?: Presentation }
  | { type: 'posts'; source: { strategy: 'latest' | 'recently-updated' }; variant: 'hero' | 'split' | 'list' | 'cards' | 'grid'; limit: number; columns?: 1 | 2 | 3; presentation?: Presentation }
  | { type: 'topics'; variant: 'list' | 'cloud'; limit: number; presentation?: Presentation }
  | { type: 'author'; variant: 'compact' | 'profile'; presentation?: Presentation };

export type ArticleModuleV2 =
  | { type: 'metadata'; variant: 'compact' | 'detailed'; presentation?: Presentation }
  | { type: 'toc'; variant: 'inline' | 'aside'; presentation?: Presentation }
  | { type: 'tags'; variant: 'list'; presentation?: Presentation }
  | { type: 'author'; variant: 'compact' | 'profile'; presentation?: Presentation }
  | { type: 'related-posts'; variant: 'list' | 'cards'; limit: 2 | 3 | 5; presentation?: Presentation }
  | { type: 'navigation'; variant: 'links' | 'cards'; presentation?: Presentation };

export interface GeneratedDesignV2 {
  version: 2;
  theme: { motif: 'minimal' | 'editorial' | 'notebook' };
  chrome: {
    header: { variant: 'compact' | 'centered' | 'masthead' };
    footer: { variant: 'minimal' | 'profile' };
  };
  pages: {
    home: {
      layout: 'stack' | 'sidebar' | 'magazine';
      sections: Record<string, HomeSectionV2>;
      regions: Record<string, string[]>;
    };
    index: {
      layout: 'list' | 'grid' | 'magazine';
      columns?: 1 | 2 | 3;
      item: { variant: 'divided' | 'cards' | 'numbered'; showDescription: boolean; showTags: boolean };
    };
    article: {
      layout: 'reading' | 'wide' | 'with-aside';
      header: { variant: 'simple' | 'editorial' };
      modules: Record<string, ArticleModuleV2>;
      regions: { beforeBody: string[]; aside: string[]; afterBody: string[] };
      prose: { codeBlock: 'plain' | 'panel' };
    };
  };
}

export const design = value as unknown as GeneratedDesignV2;
