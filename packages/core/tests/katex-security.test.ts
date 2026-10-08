import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('KaTeX renderer options', () => {
  it('verifies the shipped math bundle in an isolated process', () => {
    const script = readFileSync(new URL('../scripts/math-bundle-smoke.mjs', import.meta.url), 'utf8');
    const core = new URL('../dist/index.js', import.meta.url).href;
    expect(execFileSync(process.execPath, ['--input-type=module', '--eval', script, core], { encoding: 'utf8' })).toContain('Embedded KaTeX 0.18.2');
    expect(Object.hasOwn(Object.prototype, 'trust')).toBe(false);
  });

  it('rejects inherited trust in both dependency paths without polluting the test process', () => {
    const paths = [require.resolve('rehype-katex'), require.resolve('remark-math')];
    const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', String.raw`
      import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
      const results = JSON.parse(process.argv[1]).map((path) => {
        const rendererRequire = createRequire(path);
        const katex = path.includes('rehype-katex') ? rendererRequire('katex')
          : createRequire(rendererRequire.resolve('micromark-extension-math'))('katex');
        const results = [];
        Object.defineProperty(Object.prototype, 'trust', { value: true, writable: true, configurable: true });
        try {
          for (const options of [{ output: 'mathml' }, { output: 'mathml', trust: false }]) {
            const html = katex.renderToString('\\href{https://example.com/probe}{probe}', options);
            results.push(html.includes('href="https://example.com/probe"'));
          }
        } finally { delete Object.prototype.trust; }
        const inherited = katex.renderToString('\\href{https://example.com/probe}{probe}', Object.assign(Object.create({ trust: true }), { output: 'mathml' }));
        return { version: katex.version, links: [...results, inherited.includes('href="https://example.com/probe"')],
          math: katex.renderToString('E = mc^2', { output: 'mathml', trust: false }).includes('<math'),
          invalid: katex.renderToString('\\broken{', { output: 'mathml', trust: false, throwOnError: false }).includes('katex-error') };
      });
      console.log(JSON.stringify(results));
    `, JSON.stringify(paths)], { encoding: 'utf8' })) as { version: string; links: boolean[]; math: boolean; invalid: boolean }[];
    expect(results).toHaveLength(2);
    for (const result of results) expect(result).toEqual({ version: '0.18.2', links: [false, false, false], math: true, invalid: true });
    expect(Object.hasOwn(Object.prototype, 'trust')).toBe(false);
  });
});
