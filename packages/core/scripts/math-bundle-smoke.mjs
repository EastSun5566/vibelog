// Executed with node --input-type=module --eval in an isolated process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const core = process.argv[1] ?? import.meta.resolve('@vibelog/core');
const require = createRequire(core);
const { createMarkdownProcessor } = /** @type {typeof import('@astrojs/markdown-remark')} */ (await import(pathToFileURL(require.resolve('@astrojs/markdown-remark')).href));
const { remarkMath, rehypeKatex } = /** @type {typeof import('../src/core/math-plugins.js')} */ (await import(new URL('./core/math-plugins.js', core).href));
const dependencies = /** @type {{name: string, version: string}[]} */ (JSON.parse(readFileSync(new URL('./core/math-plugins.json', core), 'utf8')));
assert.deepEqual(dependencies.filter((pkg) => pkg.name === 'katex').map((pkg) => pkg.version), ['0.18.2']);
assert(!JSON.stringify(dependencies).includes('node_modules'));
/** @param {string} markdown @param {{trust?: boolean}} options */
const render = async (markdown, options = {}) => {
  const processor = await createMarkdownProcessor({ syntaxHighlight: false, remarkPlugins: [remarkMath], rehypePlugins: [[rehypeKatex, Object.assign(options, { output: 'mathml', strict: 'ignore', throwOnError: false })]] });
  return (await processor.render(markdown)).code;
};
for (const markdown of ['$E=mc^2$', '$$\nE=mc^2\n$$', '```math\nE=mc^2\n```']) assert((await render(markdown, { trust: false })).includes('<math'));
assert((await render('$\\broken{$', { trust: false })).includes('katex-error'));
const dangerous = ['$\\href{https://example.com/probe}{probe}$', '$\\href{javascript:alert(1)}{probe}$', '$\\includegraphics{https://example.com/probe.png}$'];
Object.defineProperty(Object.prototype, 'trust', { value: true, writable: true, configurable: true });
try {
  for (const options of [{}, { trust: false }, /** @type {{trust?: boolean}} */ (Object.create({ trust: true }))]) {
    for (const markdown of dangerous) assert(!/(?:href|src)=["']/.test(await render(markdown, options)), 'Inherited options enabled an untrusted link/resource');
  }
} finally { delete Object.prototype.trust; }
console.log('Embedded KaTeX 0.18.2: MathML, fallback and untrusted/inherited options passed.');
