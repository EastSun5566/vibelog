import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

export async function createDatabaseBackup(dataRootInput: string, destinationInput?: string) {
  const dataRoot = resolve(dataRootInput);
  const sourcePath = join(dataRoot, 'vibelog.sqlite');
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const destinationPath = resolve(destinationInput ?? join(dataRoot, 'backups', `vibelog-${timestamp}.sqlite`));

  await access(sourcePath).catch(() => { throw new Error(`SQLite database not found: ${sourcePath}`); });
  await access(destinationPath).then(
    () => { throw new Error(`Backup destination already exists: ${destinationPath}`); },
    () => undefined,
  );
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const pages = await backup(source, destinationPath);
    const copy = new DatabaseSync(destinationPath, { readOnly: true });
    try {
      const result = copy.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
      if (result?.integrity_check !== 'ok') throw new Error(`Backup integrity check failed: ${String(result?.integrity_check)}`);
    } finally {
      copy.close();
    }
    return { backup: destinationPath, pages, integrityCheck: 'ok' as const };
  } catch (error) {
    await rm(destinationPath, { force: true });
    throw error;
  } finally {
    source.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await createDatabaseBackup(process.env.DATA_ROOT ?? '.data', process.argv[2])));
}
