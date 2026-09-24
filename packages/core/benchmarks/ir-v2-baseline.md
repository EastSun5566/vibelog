# Design build baseline

V1 local synthetic run, 2026-09-24, before the V2-only compiler change. Twenty Markdown posts with code fences; one frozen source, three complete builds. `pnpm --filter @vibelog/core benchmark:design-build` now measures V2 on the same synthetic input for comparison. These numbers are not production latency because they exclude R2 transfer, AI, and DB work.

| Run | Total | Astro | Pagefind | Prepare | Source copy |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,356 ms | 1,152 ms | 171 ms | 15 ms | 4 ms |
| 2 | 729 ms | 563 ms | 145 ms | 6 ms | 3 ms |
| 3 | 785 ms | 557 ms | 210 ms | 6 ms | 2 ms |

Warm-run median: 757 ms total; 560 ms Astro; 178 ms Pagefind. The CSS-only path should remove both Astro and Pagefind. Production `operation_stage` logs will show whether artifact transfer changes the priority.

V2 local synthetic run on the same 20-post input, 2026-09-24, after the V2-only compiler change:

| Run | Total | Astro | Pagefind | Prepare | Source copy |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,678 ms | 1,391 ms | 248 ms | 9 ms | 4 ms |
| 2 | 1,070 ms | 831 ms | 209 ms | 8 ms | 3 ms |
| 3 | 1,073 ms | 808 ms | 233 ms | 8 ms | 3 ms |

Warm-run median: 1,072 ms total; 820 ms Astro; 221 ms Pagefind. Full structural builds are slower in this small sample. A presentation-only change now avoids both stages and copies the existing immutable draft with a new `design.css`; its end-to-end gain must be measured with real artifact transfer in an operation, rather than inferred from this local build benchmark. These figures are three runs on one machine, not a production performance claim.
