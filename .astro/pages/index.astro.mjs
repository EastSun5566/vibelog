import { c as createComponent, r as renderComponent, a as renderHead, d as renderTemplate } from '../chunks/astro/server_DRJHuRqs.mjs';
import 'kleur/colors';
import { g as getCollection, r as renderEntry, S as SITE_DESCRIPTION, a as SITE_TITLE } from '../chunks/consts_BsaQS8pN.mjs';
import { $ as $$BaseHead, a as $$Header, b as $$Footer } from '../chunks/Footer_BdAqnmVT.mjs';
export { renderers } from '../renderers.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const [author] = await getCollection("author");
  const { Content } = await renderEntry(author);
  return renderTemplate`<html lang="en"> <head>${renderComponent($$result, "BaseHead", $$BaseHead, { "title": SITE_TITLE, "description": SITE_DESCRIPTION })}${renderHead()}</head> <body> ${renderComponent($$result, "Header", $$Header, {})} <main> <h1>${author.data.name}</h1> ${renderComponent($$result, "Content", Content, {})} </main> ${renderComponent($$result, "Footer", $$Footer, { "name": author.data.name })} </body></html>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/index.astro", void 0);

const $$file = "/tmp/vibelog-e2e-70EwhS/.vibelog/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
