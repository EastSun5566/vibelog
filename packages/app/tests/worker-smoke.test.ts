import { describe, expect, it, vi } from 'vitest';
import { smokeWorker } from '../scripts/worker-smoke.js';

const config = { workerUrl: 'https://worker.run.app', queuePath: 'projects/test/locations/region/queues/operations', invokerEmail: 'tasks@test.iam.gserviceaccount.com', accessToken: 'test-token' };
function fixture(status: string) {
  const query = vi.fn((sql: string, _values?: unknown[]) => Promise.resolve({ rows: sql.startsWith('select') ? [{ status, attempts: status === 'queued' ? 0 : 1 }] : [] }));
  const request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
  const wait = vi.fn(() => Promise.resolve());
  return { database: { query }, dependencies: { fetch: request, wait, polls: 2 } };
}
describe('worker deployment smoke', () => {
  it('targets the production worker with its stable audience, then removes its isolated fixture', async () => {
    const { database, dependencies } = fixture('failed');
    await smokeWorker(config, database, dependencies);
    const options = dependencies.fetch.mock.calls[0]?.[1];
    if (typeof options?.body !== 'string') throw new Error('Missing task body');
    const body = JSON.parse(options.body) as { task: { name: string; httpRequest: { url: string; oidcToken: { audience: string; serviceAccountEmail: string }; body: string } } };
    expect(body.task.httpRequest).toMatchObject({ url: `${config.workerUrl}/tasks/operations`, oidcToken: { audience: config.workerUrl, serviceAccountEmail: config.invokerEmail } });
    expect(JSON.parse(Buffer.from(body.task.httpRequest.body, 'base64').toString())).toMatchObject({ version: 1 });
    expect(dependencies.fetch.mock.calls[1]).toEqual([`https://cloudtasks.googleapis.com/v2/${body.task.name}`, expect.objectContaining({ method: 'DELETE' })]);
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('delete from "user" where id = $1');
    expect(dependencies.wait).not.toHaveBeenCalled();
  });
  it('does not promote a task that was merely queued and cleans up after timeout', async () => {
    const { database, dependencies } = fixture('queued');
    await expect(smokeWorker(config, database, dependencies)).rejects.toThrow('in time');
    expect(dependencies.wait).toHaveBeenCalledTimes(2);
    expect(dependencies.fetch.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('delete from "user" where id = $1');
  });
  it('cleans both resources even when task creation has an ambiguous network failure', async () => {
    const { database, dependencies } = fixture('queued');
    dependencies.fetch.mockRejectedValueOnce(new Error('request timeout')).mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(smokeWorker(config, database, dependencies)).rejects.toThrow('request timeout');
    expect(dependencies.fetch.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('delete from "user" where id = $1');
  });
});
