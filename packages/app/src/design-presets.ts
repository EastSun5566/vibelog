import { applyDesignPatchV2, contrastRatio } from '@vibelog/core';
import type { BlogDesignSpecV2 } from '@vibelog/core';
import { THEME_PALETTES } from './theme-studio.js';

interface DesignPatchOperation {
  op: 'add' | 'replace';
  path: string;
  value: unknown;
}
interface DesignPreset {
  label: string;
  patch(design: BlogDesignSpecV2): DesignPatchOperation[];
}

const replace = (path: string, value: unknown): DesignPatchOperation => ({
  op: 'replace',
  path,
  value,
});

// Accents that stay at least 4.5:1 on every built-in palette of the same appearance.
const PERSONALITY_ACCENT = { light: '#9d174d', dark: '#f9a8d4' } as const;

/**
 * Starter designs that apply without an AI call. Each preset only touches fields that every
 * valid design has, so it composes with any palette, homepage composition or article modules.
 */
export const DESIGN_PRESETS = {
  magazine: {
    label: 'A restrained independent magazine',
    patch: (design) => [
      replace('/theme/motif', 'editorial'),
      replace('/theme/appearance', THEME_PALETTES.newsprint.appearance),
      replace('/theme/colors', { ...THEME_PALETTES.newsprint.colors }),
      replace('/theme/typography', {
        bodyFont: 'system-serif',
        headingFont: 'system-serif',
        scale: 'comfortable',
      }),
      replace('/theme/layout', { ...design.theme.layout, contentWidth: 'medium', radius: 'none' }),
      replace('/chrome/header/variant', 'masthead'),
      replace('/pages/index/item/variant', 'divided'),
      replace('/pages/article/header/variant', 'editorial'),
      replace(
        '/description',
        'A restrained independent magazine: newsprint tones, serif type, a masthead and editorial article headers.',
      ),
    ],
  },
  readable: {
    label: 'Make long articles easier to read',
    patch: (design) => [
      replace('/theme/typography', {
        ...design.theme.typography,
        bodyFont: 'system-serif',
        scale: 'large',
      }),
      replace('/theme/layout', {
        ...design.theme.layout,
        contentWidth: 'narrow',
        density: 'comfortable',
      }),
      // A wide article never has aside modules, so narrowing it is always valid.
      ...(design.pages.article.layout === 'wide'
        ? [replace('/pages/article/layout', 'reading')]
        : []),
      replace('/pages/article/prose/codeBlock', 'panel'),
      replace(
        '/description',
        'Built for long reads: larger serif body text, a narrow measure and roomy spacing.',
      ),
    ],
  },
  personality: {
    label: 'Keep it minimal but add personality',
    patch: (design) => {
      const accent = PERSONALITY_ACCENT[design.theme.appearance];
      return [
        replace('/theme/motif', 'notebook'),
        replace('/theme/typography/headingFont', 'system-mono'),
        replace('/theme/layout/radius', 'round'),
        ...(contrastRatio(accent, design.theme.colors.background) >= 4.5
          ? [replace('/theme/colors/accent', accent)]
          : []),
        replace('/chrome/header/variant', 'centered'),
        replace('/pages/index/item/variant', 'numbered'),
        replace(
          '/description',
          'Minimal with a twist: notebook rules, monospace headings, a bold accent and numbered posts.',
        ),
      ];
    },
  },
  night: {
    label: 'A dark design for night reading',
    patch: (design) => [
      replace('/theme/appearance', THEME_PALETTES.charcoal.appearance),
      replace('/theme/colors', { ...THEME_PALETTES.charcoal.colors }),
      replace('/theme/layout', { ...design.theme.layout, density: 'comfortable' }),
      replace('/pages/article/prose/codeBlock', 'panel'),
      replace(
        '/description',
        'A warm, low-glare dark design for night reading with soft amber links.',
      ),
    ],
  },
} as const satisfies Record<string, DesignPreset>;

export type DesignPresetId = keyof typeof DESIGN_PRESETS;
export const DESIGN_PRESET_IDS = Object.keys(DESIGN_PRESETS) as [
  DesignPresetId,
  ...DesignPresetId[],
];

export function applyDesignPreset(design: BlogDesignSpecV2, id: DesignPresetId): BlogDesignSpecV2 {
  return applyDesignPatchV2(design, DESIGN_PRESETS[id].patch(design));
}
