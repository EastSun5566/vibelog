import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { join, relative, sep } from 'node:path';

export function fingerprintEntries(entries: readonly (readonly [string, string])[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
    .digest('hex');
}

export function fingerprintFiles(root: string, files: readonly string[]): string {
  return fingerprintEntries(
    files.map((file) => [
      relative(root, file).split(sep).join('/'),
      createHash('sha256').update(readFileSync(file)).digest('hex'),
    ]),
  );
}

export function templateFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return templateFiles(path);
    if (!entry.isFile()) throw new Error('Template fingerprint requires regular files');
    return [path];
  });
}

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function packageDirectory(from: string, name: string): string {
  const require = createRequire(join(from, 'package.json'));
  // Some rendering packages export only subpaths, not their entry or package.json.
  for (const path of require.resolve.paths(name) ?? []) {
    const directory = join(path, name);
    try {
      const manifest = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
      ) as PackageManifest;
      if (manifest.name === name) return realpathSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Cannot locate rendering dependency ${name}`);
}

/** Resolve once per process, including npm consumers whose dependency graph differs from the build. */
export function dependencyFingerprint(root: string, names: readonly string[]): string {
  const visited = new Set<string>();
  const records = new Set<string>();
  const visit = (directory: string): void => {
    if (visited.has(directory)) return;
    visited.add(directory);
    const pkg = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    ) as PackageManifest;
    if (!pkg.name || !pkg.version) throw new Error('Rendering dependency has no identity');
    const edges: [string, string][] = [];
    const dependencies = {
      ...pkg.peerDependencies,
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    };
    for (const name of Object.keys(dependencies).sort()) {
      if (isBuiltin(name)) continue;
      let child: string;
      try {
        child = packageDirectory(directory, name);
      } catch (error) {
        const optional =
          Object.hasOwn(pkg.optionalDependencies ?? {}, name) ||
          (!Object.hasOwn(pkg.dependencies ?? {}, name) &&
            pkg.peerDependenciesMeta?.[name]?.optional);
        if (!optional)
          throw new Error(`Missing rendering dependency ${pkg.name} → ${name}`, { cause: error });
        edges.push([name, 'absent']);
        continue;
      }
      const manifest = JSON.parse(
        readFileSync(join(child, 'package.json'), 'utf8'),
      ) as PackageManifest;
      edges.push([name, `${manifest.name}@${manifest.version}`]);
      visit(child);
    }
    records.add(JSON.stringify([pkg.name, pkg.version, edges]));
  };
  const roots = [...new Set(names)].sort().map((name) => {
    const directory = packageDirectory(root, name);
    const pkg = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8'),
    ) as PackageManifest;
    visit(directory);
    return [name, `${pkg.name}@${pkg.version}`] as const;
  });
  return fingerprintEntries([
    ['roots', JSON.stringify(roots)],
    ['packages', JSON.stringify([...records].sort())],
  ]);
}
