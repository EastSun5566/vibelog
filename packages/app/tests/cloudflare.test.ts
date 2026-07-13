import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { deployToCloudflarePages } from '../src/deploy/cloudflare.js';

function childProcess(stdout: string, stderr = '', exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', exitCode);
  });
  return child;
}

describe('Cloudflare Wrangler boundary', () => {
  beforeEach(() => spawnMock.mockReset());

  it('passes credentials only through the child environment', async () => {
    const apiToken = 'cloudflare-super-secret';
    const accountId = 'account-super-secret';
    spawnMock.mockReturnValue(childProcess('Deployment complete: https://preview.example.pages.dev\n'));

    await expect(deployToCloudflarePages('/safe/dist', {
      apiToken,
      accountId,
      projectName: 'safe-project',
    })).resolves.toMatchObject({ success: true, url: 'https://preview.example.pages.dev' });

    const [executable, argv, options] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(executable).toBe(process.execPath);
    expect(argv.join(' ')).not.toContain(apiToken);
    expect(argv.join(' ')).not.toContain(accountId);
    expect(argv).toContain('/safe/dist');
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe(apiToken);
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
  });

  it('redacts secrets from Wrangler failures', async () => {
    const apiToken = 'cloudflare-super-secret';
    const accountId = 'account-super-secret';
    spawnMock.mockReturnValue(childProcess('', `failed token=${apiToken} account=${accountId}`, 1));

    const error = await deployToCloudflarePages('/safe/dist', {
      apiToken,
      accountId,
      projectName: 'safe-project',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(apiToken);
    expect((error as Error).message).not.toContain(accountId);
  });
});
