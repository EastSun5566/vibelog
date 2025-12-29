import { c as createComponent, r as renderComponent, a as renderHead, b as addAttribute, d as renderTemplate } from '../chunks/astro/server_DRJHuRqs.mjs';
import 'kleur/colors';
import { g as getCollection, S as SITE_DESCRIPTION, a as SITE_TITLE } from '../chunks/consts_BsaQS8pN.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from '../chunks/Footer_BdAqnmVT.mjs';
import { $ as $$FormattedDate } from '../chunks/FormattedDate_B1R_9WbE.mjs';
export { renderers } from '../renderers.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );
  const [author] = await getCollection("author");
  return renderTemplate`<html lang="en"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": SITE_TITLE, "description": SITE_DESCRIPTION })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <section> <ul class="blog-list"> ${posts.map((post) => renderTemplate`<li class="blog-list-item"> <a${addAttribute(`/blog/${post.id}/`, "href")} class="blog-item-link"> <h4 class="blog-item-title">${post.data.title}</h4> <p class="blog-item-date"> ${renderComponent($$result, "FormattedDate", $$FormattedDate, { "date": post.data.date })} </p> </a> </li>`)} </ul> </section> </main> ${renderComponent($$result, "Footer", $$Footer, { "name": author.data.name })} </body></html>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/blog/index.astro", void 0);

const $$file = "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/blog/index.astro";
const $$url = "/blog";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
