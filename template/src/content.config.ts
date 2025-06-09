import { defineCollection, z } from 'astro:content';

const { glob } = await import('astro/loaders');

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: z.object({
		title: z.string(),
		description: z.string(),
    date: z.coerce.date(),
    slug: z.string()
	}),
});

const author = defineCollection({
	loader: glob({ base: './src/content', pattern: 'author.{md,mdx}' }),
	schema: z.object({
		name: z.string(),
	}),
});

export const collections = { blog, author };
