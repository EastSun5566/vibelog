# Dependency review

Reviewed on 2026-10-09. This covers the three listed Dependabot alerts, not an exhaustive security assessment. No repository `SECURITY.md` was present. Alerts remain open until the dependency graph is updated or a separate review explicitly resolves them; none are dismissed by this change.

## #262 — KaTeX

[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) affects versions `>=0.11.0 <0.18.2`. A narrow pnpm override updates both `rehype-katex → katex` and `remark-math → micromark-extension-math → katex` to 0.18.2.

HackMD math reaches `packages/core/src/core/render-worker.ts` through the content adapter, Markdown source and Astro. The renderer uses MathML and an explicit `trust: false`, including the invalid-math fallback. It runs in a separate process. The advisory needs pre-existing prototype pollution or attacker control of the renderer options prototype; no such path was established in this review. This is a vulnerable dependency update, not a claim of confirmed production XSS.

An isolated regression test covers inherited trust and normal rendering. Template version 18 invalidates old build keys, and presentation-only copies require a matching current source/design/renderer identity. Old releases and unchanged-design operations do not rebuild themselves: existing blogs need Sync, preview review and explicit Publish to refresh their rendered output.

## #264 — sprintf-js

[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) has no listed patched version as of this review. The runtime dependency chain is `gray-matter → js-yaml 3.15.2 → argparse 1.0.10 → sprintf-js 1.0.3`.

`packages/core/src/core/frontmatter.ts` calls gray-matter's YAML library engine (`safeLoad`/`safeDump`). js-yaml's library entry loads `lib/js-yaml.js`; argparse is imported by `bin/js-yaml.js`, not that library path. No VibeLog caller invokes this CLI or passes imported content as a sprintf format string. The current application path therefore does not establish the advisory's attacker-controlled-format precondition. The vulnerable package still exists in the runtime graph; retain the alert and reassess if CLI use or upstream dependencies change.

## #258 — braces

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no listed patched version as of this review. The workspace chain is `@tailwindcss/cli → @parcel/watcher → micromatch → braces 3.0.3`, under app devDependencies.

The CSS build consumes repository source paths. No supported user-input-to-glob path was found. `packages/app/Dockerfile` copies only `pnpm deploy --prod` output into the runtime stage, and the container smoke checks that the resulting image has no braces package. This does not make the upstream dependency safe or cover arbitrary developer-controlled build configurations. Retain the alert until an upstream fix or a separately reviewed dependency change is available.

## Validation and remaining work

- Local `pnpm check` passed all 462 tests, `pnpm build` passed, and Compose E2E passed all three browser flows plus the IR v2 migration preservation check. The production-container smoke passed, confirming both math dependency paths resolve KaTeX 0.18.2 and braces is absent from the runtime image.
- Full `pnpm audit` reports two remaining advisories: braces (high) and sprintf-js (moderate). `pnpm audit --prod` reports only sprintf-js (moderate). Both audit commands intentionally retain their nonzero result; no advisory is excluded.
- Do not replace the YAML parser or build watcher merely to clear the alert count. Revisit both dependency chains when patched upstream releases become available.
