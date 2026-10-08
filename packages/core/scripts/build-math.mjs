import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/core/math-plugins.ts'],
  outfile: 'dist/core/math-plugins.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  metafile: true,
  legalComments: 'inline',
});

for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (imported.external && !isBuiltin(imported.path)) {
      throw new Error(`Math bundle has an external dependency: ${imported.path}`);
    }
  }
}

// Only dependency inputs are inspected; published metadata never contains build paths.
/** @type {Map<string, { name: string, version: string, license?: string, text: string }>} */
const dependencies = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (true) {
    /** @type {{ name?: string, version?: string, license?: string } | undefined} */
    let manifest;
    try { manifest = /** @type {{ name?: string, version?: string, license?: string }} */ (JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (manifest?.name && manifest.version) {
      const key = `${manifest.name}@${manifest.version}`;
      if (!dependencies.has(key)) {
        const licenses = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying)([.-]|$)/i.test(name)).sort();
        const texts = await Promise.all(licenses.map((name) => readFile(join(directory, name), 'utf8')));
        // These tarballs omit https://github.com/remarkjs/remark-math/blob/main/license.
        if (!texts.length && ['remark-math@6.0.0', 'rehype-katex@7.0.1'].includes(key)) {
          texts.push(await readFile(join(root, 'scripts/licenses/remark-math-MIT.txt'), 'utf8'));
        }
        if (!texts.length) throw new Error(`License missing for bundled dependency ${key}`);
        dependencies.set(key, { name: manifest.name, version: manifest.version, license: manifest.license, text: texts.join('\n\n') });
      }
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot identify a bundled dependency');
    directory = parent;
  }
}
const packages = [...dependencies.values()].sort((a, b) => a.name.localeCompare(b.name));
const katex = packages.filter((pkg) => pkg.name === 'katex');
if (katex.length !== 1 || katex[0].version !== '0.18.2') throw new Error('Math bundle must embed only KaTeX 0.18.2');
await writeFile(join(root, 'dist/core/math-plugins.json'), `${JSON.stringify(packages.map(({ name, version, license }) => ({ name, version, license })), null, 2)}\n`);
await writeFile(join(root, 'dist/THIRD_PARTY_NOTICES.txt'), `Bundled math dependencies\n\n${packages.map((pkg) => `${pkg.name}@${pkg.version}\n${pkg.text}`).join('\n\n---\n\n')}\n`);
console.log(`Bundled math plugins with KaTeX 0.18.2 (${String(packages.length)} licensed dependencies).`);
