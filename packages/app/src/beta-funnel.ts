import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface CountRow { count: number }
interface UserRow { id: string; createdAt: number }
interface ReleaseRow { blogId: string; userId: string; createdAt: string }
interface OperationRow { status: 'succeeded' | 'failed'; count: number }

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] ?? null : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const databasePath = join(resolve(process.env.DATA_ROOT ?? '.data'), 'vibelog.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const registeredUsers = (database.prepare('SELECT COUNT(*) AS count FROM user').get() as unknown as CountRow).count;
  const blogsCreated = (database.prepare('SELECT COUNT(*) AS count FROM blogs').get() as unknown as CountRow).count;
  const users = database.prepare('SELECT id, created_at AS createdAt FROM user').all() as unknown as UserRow[];
  const releases = database.prepare(`
    SELECT published_releases.blog_id AS blogId, blogs.user_id AS userId, published_releases.created_at AS createdAt
    FROM published_releases
    JOIN blogs ON blogs.id = published_releases.blog_id
    ORDER BY published_releases.created_at ASC, published_releases.id ASC
  `).all() as unknown as ReleaseRow[];
  const operations = database.prepare(`
    SELECT status, COUNT(*) AS count
    FROM operations
    WHERE status IN ('succeeded', 'failed')
    GROUP BY status
  `).all() as unknown as OperationRow[];

  const releasesByUser = new Map<string, ReleaseRow[]>();
  for (const release of releases) releasesByUser.set(release.userId, [...(releasesByUser.get(release.userId) ?? []), release]);
  const activationMinutes = users.flatMap((user) => {
    const first = releasesByUser.get(user.id)?.[0];
    return first ? [(Date.parse(first.createdAt) - user.createdAt) / 60_000] : [];
  });
  const publishedAuthors = releasesByUser.size;
  const republishedWithin7Days = [...releasesByUser.values()].filter((items) => {
    const first = items[0]; const second = items[1];
    return Boolean(first && second && Date.parse(second.createdAt) - Date.parse(first.createdAt) <= 7 * 24 * 60 * 60_000);
  }).length;
  const succeeded = operations.find((row) => row.status === 'succeeded')?.count ?? 0;
  const failed = operations.find((row) => row.status === 'failed')?.count ?? 0;
  const completed = succeeded + failed;

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    registeredUsers,
    blogsCreated,
    publishedAuthors,
    medianSignupToFirstPublishMinutes: median(activationMinutes),
    republishedWithin7Days,
    republishedWithin7DaysRate: publishedAuthors > 0 ? republishedWithin7Days / publishedAuthors : null,
    completedOperations: completed,
    operationSuccessRate: completed > 0 ? succeeded / completed : null,
  }, null, 2));
} finally {
  database.close();
}
