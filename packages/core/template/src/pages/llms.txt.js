import { getCollection } from "astro:content";

import { SITE_DESCRIPTION, SITE_TITLE } from "../consts";
import { markdownText } from "../markdown-text.js";

export async function GET({ site }) {
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id),
  );
  const lines = [
    `# ${markdownText(SITE_TITLE)}`,
    "",
    ...(SITE_DESCRIPTION ? [`> ${markdownText(SITE_DESCRIPTION)}`, ""] : []),
    "## Posts",
    "",
    ...posts.map((post) => {
      const url = new URL(`/blog/${post.id}/index.md`, site).href;
      return `- [${markdownText(post.data.title)}](${url}): ${markdownText(post.data.description)}`;
    }),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
