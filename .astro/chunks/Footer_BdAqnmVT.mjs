import { e as createAstro, c as createComponent, b as addAttribute, d as renderTemplate, m as maybeRenderHead, s as spreadAttributes, f as renderSlot, r as renderComponent } from './astro/server_DRJHuRqs.mjs';
import 'kleur/colors';
import 'clsx';
/* empty css                          */
import { a as SITE_TITLE } from './consts_BsaQS8pN.mjs';

const $$Astro$3 = createAstro("https://test-blog.com");
const $$BaseHead = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$3, $$props, $$slots);
  Astro2.self = $$BaseHead;
  const canonicalURL = new URL(Astro2.url.pathname, Astro2.site);
  const { title, description, image = "/blog-placeholder-1.jpg" } = Astro2.props;
  return renderTemplate`<!-- Global Metadata --><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="sitemap" href="/sitemap-index.xml"><link rel="alternate" type="application/rss+xml"${addAttribute(SITE_TITLE, "title")}${addAttribute(new URL("rss.xml", Astro2.site), "href")}><meta name="generator"${addAttribute(Astro2.generator, "content")}><!-- Canonical URL --><link rel="canonical"${addAttribute(canonicalURL, "href")}><!-- Primary Meta Tags --><title>${title}</title><meta name="title"${addAttribute(title, "content")}><meta name="description"${addAttribute(description, "content")}><!-- Open Graph / Facebook --><meta property="og:type" content="website"><meta property="og:url"${addAttribute(Astro2.url, "content")}><meta property="og:title"${addAttribute(title, "content")}><meta property="og:description"${addAttribute(description, "content")}><meta property="og:image"${addAttribute(new URL(image, Astro2.url), "content")}><!-- Twitter --><meta property="twitter:card" content="summary_large_image"><meta property="twitter:url"${addAttribute(Astro2.url, "content")}><meta property="twitter:title"${addAttribute(title, "content")}><meta property="twitter:description"${addAttribute(description, "content")}><meta property="twitter:image"${addAttribute(new URL(image, Astro2.url), "content")}>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/components/BaseHead.astro", void 0);

const $$Astro$2 = createAstro("https://test-blog.com");
const $$HeaderLink = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$2, $$props, $$slots);
  Astro2.self = $$HeaderLink;
  const { href, class: className, ...props } = Astro2.props;
  const pathname = Astro2.url.pathname.replace(process.env.BASE_URL, "");
  const subpath = pathname.match(/[^\/]+/g);
  const isActive = href === pathname || href === "/" + (subpath?.[0] || "");
  return renderTemplate`${maybeRenderHead()}<a${addAttribute(href, "href")}${addAttribute([className, { active: isActive }], "class:list")}${spreadAttributes(props)}> ${renderSlot($$result, $$slots["default"])} </a>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/components/HeaderLink.astro", void 0);

const $$Astro$1 = createAstro("https://test-blog.com");
const $$Header = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$1, $$props, $$slots);
  Astro2.self = $$Header;
  return renderTemplate`${maybeRenderHead()}<header class="site-header"> <nav> <h2><a href="/">${SITE_TITLE}</a></h2> <div class="site-nav-links"> ${renderComponent($$result, "HeaderLink", $$HeaderLink, { "href": "/" }, { "default": ($$result2) => renderTemplate`Home` })} ${renderComponent($$result, "HeaderLink", $$HeaderLink, { "href": "/blog" }, { "default": ($$result2) => renderTemplate`Blog` })} </div> <!-- <div class="social-links">
			<a href="https://m.webtoo.ls/@astro" target="_blank">
				<span class="sr-only">Follow Astro on Mastodon</span>
				<svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32"
					><path
						fill="currentColor"
						d="M11.19 12.195c2.016-.24 3.77-1.475 3.99-2.603.348-1.778.32-4.339.32-4.339 0-3.47-2.286-4.488-2.286-4.488C12.062.238 10.083.017 8.027 0h-.05C5.92.017 3.942.238 2.79.765c0 0-2.285 1.017-2.285 4.488l-.002.662c-.004.64-.007 1.35.011 2.091.083 3.394.626 6.74 3.78 7.57 1.454.383 2.703.463 3.709.408 1.823-.1 2.847-.647 2.847-.647l-.06-1.317s-1.303.41-2.767.36c-1.45-.05-2.98-.156-3.215-1.928a3.614 3.614 0 0 1-.033-.496s1.424.346 3.228.428c1.103.05 2.137-.064 3.188-.189zm1.613-2.47H11.13v-4.08c0-.859-.364-1.295-1.091-1.295-.804 0-1.207.517-1.207 1.541v2.233H7.168V5.89c0-1.024-.403-1.541-1.207-1.541-.727 0-1.091.436-1.091 1.296v4.079H3.197V5.522c0-.859.22-1.541.66-2.046.456-.505 1.052-.764 1.793-.764.856 0 1.504.328 1.933.983L8 4.39l.417-.695c.429-.655 1.077-.983 1.934-.983.74 0 1.336.259 1.791.764.442.505.661 1.187.661 2.046v4.203z"
					></path></svg
				>
			</a>
			<a href="https://twitter.com/astrodotbuild" target="_blank">
				<span class="sr-only">Follow Astro on Twitter</span>
				<svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32"
					><path
						fill="currentColor"
						d="M5.026 15c6.038 0 9.341-5.003 9.341-9.334 0-.14 0-.282-.006-.422A6.685 6.685 0 0 0 16 3.542a6.658 6.658 0 0 1-1.889.518 3.301 3.301 0 0 0 1.447-1.817 6.533 6.533 0 0 1-2.087.793A3.286 3.286 0 0 0 7.875 6.03a9.325 9.325 0 0 1-6.767-3.429 3.289 3.289 0 0 0 1.018 4.382A3.323 3.323 0 0 1 .64 6.575v.045a3.288 3.288 0 0 0 2.632 3.218 3.203 3.203 0 0 1-.865.115 3.23 3.23 0 0 1-.614-.057 3.283 3.283 0 0 0 3.067 2.277A6.588 6.588 0 0 1 .78 13.58a6.32 6.32 0 0 1-.78-.045A9.344 9.344 0 0 0 5.026 15z"
					></path></svg
				>
			</a>
			<a href="https://github.com/withastro/astro" target="_blank">
				<span class="sr-only">Go to Astro's GitHub repo</span>
				<svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32"
					><path
						fill="currentColor"
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
					></path></svg
				>
			</a>
		</div> --> </nav> </header>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/components/Header.astro", void 0);

const $$Astro = createAstro("https://test-blog.com");
const $$Footer = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Footer;
  const today = /* @__PURE__ */ new Date();
  const { name } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<footer>
&copy; ${today.getFullYear()} ${name}.
<!-- <div class="social-links">
		<a href="https://m.webtoo.ls/@astro" target="_blank">
			<span class="sr-only">Follow Astro on Mastodon</span>
			<svg
				viewBox="0 0 16 16"
				aria-hidden="true"
				width="32"
				height="32"
				astro-icon="social/mastodon"
				><path
					fill="currentColor"
					d="M11.19 12.195c2.016-.24 3.77-1.475 3.99-2.603.348-1.778.32-4.339.32-4.339 0-3.47-2.286-4.488-2.286-4.488C12.062.238 10.083.017 8.027 0h-.05C5.92.017 3.942.238 2.79.765c0 0-2.285 1.017-2.285 4.488l-.002.662c-.004.64-.007 1.35.011 2.091.083 3.394.626 6.74 3.78 7.57 1.454.383 2.703.463 3.709.408 1.823-.1 2.847-.647 2.847-.647l-.06-1.317s-1.303.41-2.767.36c-1.45-.05-2.98-.156-3.215-1.928a3.614 3.614 0 0 1-.033-.496s1.424.346 3.228.428c1.103.05 2.137-.064 3.188-.189zm1.613-2.47H11.13v-4.08c0-.859-.364-1.295-1.091-1.295-.804 0-1.207.517-1.207 1.541v2.233H7.168V5.89c0-1.024-.403-1.541-1.207-1.541-.727 0-1.091.436-1.091 1.296v4.079H3.197V5.522c0-.859.22-1.541.66-2.046.456-.505 1.052-.764 1.793-.764.856 0 1.504.328 1.933.983L8 4.39l.417-.695c.429-.655 1.077-.983 1.934-.983.74 0 1.336.259 1.791.764.442.505.661 1.187.661 2.046v4.203z"
				></path></svg
			>
		</a>
		<a href="https://twitter.com/astrodotbuild" target="_blank">
			<span class="sr-only">Follow Astro on Twitter</span>
			<svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32" astro-icon="social/twitter"
				><path
					fill="currentColor"
					d="M5.026 15c6.038 0 9.341-5.003 9.341-9.334 0-.14 0-.282-.006-.422A6.685 6.685 0 0 0 16 3.542a6.658 6.658 0 0 1-1.889.518 3.301 3.301 0 0 0 1.447-1.817 6.533 6.533 0 0 1-2.087.793A3.286 3.286 0 0 0 7.875 6.03a9.325 9.325 0 0 1-6.767-3.429 3.289 3.289 0 0 0 1.018 4.382A3.323 3.323 0 0 1 .64 6.575v.045a3.288 3.288 0 0 0 2.632 3.218 3.203 3.203 0 0 1-.865.115 3.23 3.23 0 0 1-.614-.057 3.283 3.283 0 0 0 3.067 2.277A6.588 6.588 0 0 1 .78 13.58a6.32 6.32 0 0 1-.78-.045A9.344 9.344 0 0 0 5.026 15z"
				></path></svg
			>
		</a>
		<a href="https://github.com/withastro/astro" target="_blank">
			<span class="sr-only">Go to Astro's GitHub repo</span>
			<svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32" astro-icon="social/github"
				><path
					fill="currentColor"
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
				></path></svg
			>
		</a>
	</div> --> </footer>`;
}, "/tmp/vibelog-e2e-70EwhS/.vibelog/src/components/Footer.astro", void 0);

export { $$BaseHead as $, $$Header as a, $$Footer as b };
