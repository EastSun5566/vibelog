import { getCollection } from "astro:content";

import { markdownText } from "../../../markdown-text.js";

export async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET({ props, site }) {
  const { post } = props;
  if (typeof post.body !== "string") throw new Error(`Missing Markdown body for ${post.id}`);
  const canonical = new URL(`/blog/${post.id}/`, site).href;
  const lines = [
    `# ${markdownText(post.data.title)}`,
    "",
    `Published: ${post.data.date.toISOString().slice(0, 10)}`,
    ...(post.data.updatedDate && post.data.updatedDate > post.data.date
      ? [`Updated: ${post.data.updatedDate.toISOString().slice(0, 10)}`]
      : []),
    `Canonical: ${canonical}`,
    "",
  ];
  return new Response(`${lines.join("\n")}\n${post.body}`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
