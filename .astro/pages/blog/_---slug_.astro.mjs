import { e as createAstro, c as createComponent, r as renderComponent, a as renderHead, f as renderSlot, d as renderTemplate } from '../../chunks/astro/server_DRJHuRqs.mjs';
import 'kleur/colors';
import { g as getCollection, r as renderEntry } from '../../chunks/consts_BsaQS8pN.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from '../../chunks/Footer_BdAqnmVT.mjs';
import { $ as $$FormattedDate } from '../../chunks/FormattedDate_B1R_9WbE.mjs';
export { renderers } from '../../renderers.mjs';

const $$Astro$1 = createAstro("https://test-blog.com");
const $$BlogPost = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$1, $$props, $$slots);
  Astro2.self = $$BlogPost;
  const { title, description, date, updatedDate } = Astro2.props;
  const [author] = await getCollection("author");
  return renderTemplate`<html lang="en"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": title, "description": description })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <article class="blog-post"> <figure class="blog-post-hero"> <!-- hero image here --> </figure> <div class="blog-post-content"> <header class="blog-post-header"> <div class="blog-post-date"> ${renderComponent($$result, "FormattedDate", $$FormattedDate, { "date": date })} </div> <h1 class="blog-post-title">${title}</h1> ${updatedDate && renderTemplate`<div class="blog-post-update">
Last updated on ${renderComponent($$result, "FormattedDate", $$FormattedDate, { "date": updatedDate })} </div>`} </header> <div class="prose"> ${renderSlot($$result, $$slots["default"])} </div> </div> </article> </main> ${renderComponent($$result, "Footer", $$Footer, { "name": author.data.name })} </body></html>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/layouts/BlogPost.astro", void 0);

const $$Astro = createAstro("https://test-blog.com");
async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((post) => ({
    params: { slug: post.id },
    props: post
  }));
}
const $$ = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$;
  const post = Astro2.props;
  const { Content } = await renderEntry(post);
  return renderTemplate`${renderComponent($$result, "BlogPost", $$BlogPost, { ...post.data }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "Content", Content, {})} ` })}`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/blog/[...slug].astro", void 0);

const $$file = "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/blog/[...slug].astro";
const $$url = "/blog/[...slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$,
  file: $$file,
  getStaticPaths,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
