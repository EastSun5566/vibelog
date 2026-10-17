import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { join, resolve } from 'node:path';
import {
  dependencyFingerprint,
  fingerprintEntries,
  fingerprintFiles,
  templateFiles,
} from '../dist/core/fingerprint-inputs.js';

/** @param {string} root */
export async function generateBuildFingerprints(root) {
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: ['dist/core/builder.js', 'dist/core/render-worker.js'],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outdir: 'fingerprint-probe',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const templateRoot = join(root, 'template');
  const template = fingerprintFiles(templateRoot, templateFiles(templateRoot));
  const source = fingerprintFiles(
    root,
    Object.keys(metafile.inputs).map((path) => resolve(root, path)),
  );
  const templatePackage = /** @type {{ dependencies: Record<string, string> }} */ (
    JSON.parse(await readFile(join(templateRoot, 'package.json'), 'utf8'))
  );
  const dependencies = [
    ...new Set([
      ...Object.keys(templatePackage.dependencies),
      ...Object.values(metafile.outputs).flatMap((output) =>
        output.imports
          .filter((item) => item.external && !isBuiltin(item.path))
          .map((item) =>
            item.path.startsWith('@')
              ? item.path.split('/').slice(0, 2).join('/')
              : item.path.split('/')[0],
          ),
      ),
    ]),
  ].sort();
  const renderer = fingerprintEntries([
    ['template', template],
    ['source', source],
    ['dependencies', dependencyFingerprint(root, dependencies)],
  ]);
  await writeFile(
    join(root, 'dist/core/build-fingerprints.json'),
    `${JSON.stringify({ version: 1, template, source, dependencies, renderer }, null, 2)}\n`,
  );
}
