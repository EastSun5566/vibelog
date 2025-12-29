import { e as createAstro, c as createComponent, m as maybeRenderHead, b as addAttribute, d as renderTemplate } from './astro/server_DRJHuRqs.mjs';
import 'kleur/colors';
import 'clsx';

const $$Astro = createAstro("https://test-blog.com");
const $$FormattedDate = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$FormattedDate;
  const { date } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<time${addAttribute((date || /* @__PURE__ */ new Date()).toISOString(), "datetime")}> ${(date || /* @__PURE__ */ new Date()).toLocaleDateString("en-us", {
    year: "numeric",
    month: "short",
    day: "numeric"
  })} </time>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/components/FormattedDate.astro", void 0);

export { $$FormattedDate as $ };
