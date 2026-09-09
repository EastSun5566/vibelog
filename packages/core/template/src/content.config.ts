import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

const { glob } = await import('astro/loaders');

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    slug: z.string(),
    tags: z.array(z.object({
      name: z.string(),
      slug: z.string(),
    })).default([]),
  }),
});

const author = defineCollection({
  loader: glob({ base: './src/content', pattern: 'author.{md,mdx}' }),
  schema: z.object({
    name: z.string(),
  }),
});

export const collections = { blog, author };
