import value from './generated/design.json';

export type HomeSection =
  | { type: 'intro'; variant: 'minimal' | 'centered' | 'split'; showAuthor: boolean }
  | { type: 'featured-posts'; variant: 'hero' | 'split'; count: 1 | 2 }
  | { type: 'recent-posts'; variant: 'list' | 'cards' | 'grid'; limit: 3 | 5 | 6 | 9; columns?: 1 | 2 | 3 }
  | { type: 'topics'; variant: 'list' | 'cloud'; limit: 6 | 12 | 24 }
  | { type: 'author'; variant: 'compact' | 'profile' };

export interface GeneratedDesign {
  version: 1;
  chrome: { header: { variant: 'compact' | 'centered' | 'masthead' }; footer: { variant: 'minimal' | 'profile' } };
  pages: {
    home: { sections: HomeSection[] };
    index: { layout: 'list' | 'grid' | 'magazine'; itemVariant: 'divided' | 'cards' | 'numbered'; columns?: 1 | 2 | 3; showDescription: boolean; showTags: boolean };
    article: { layout: 'reading' | 'wide' | 'with-aside'; header: 'simple' | 'editorial'; toc: 'auto-inline' | 'auto-aside' | 'hidden'; metadata: 'compact' | 'detailed'; navigation: 'links' | 'cards'; codeBlock: 'plain' | 'panel' };
  };
}

export const design = value as unknown as GeneratedDesign;
