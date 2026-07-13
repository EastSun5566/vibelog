import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface CloudflarePagesConfig {
  accountId: string;
  apiToken: string;
  projectName: string;
  branch?: string;
}

export interface DeploymentResult {
  success: true;
  url: string;
  deploymentId: string;
  environment: string;
}

interface WranglerDeployment {
  Id?: string;
  id?: string;
  Url?: string;
  url?: string;
  Environment?: string;
  environment?: string;
  Created?: string;
  created_on?: string;
}

const require = createRequire(import.meta.url);
const wranglerPackage = require.resolve('wrangler/package.json');
const wranglerBin = join(dirname(wranglerPackage), 'bin', 'wrangler.js');
const MAX_OUTPUT_BYTES = 1024 * 1024;

function redact(value: string, secrets: string[]): string {
  return secrets.reduce((output, secret) => secret ? output.replaceAll(secret, '[REDACTED]') : output, value);
}

async function runWrangler(
  args: string[],
  config: Pick<CloudflarePagesConfig, 'accountId' | 'apiToken'>,
  timeoutMs = 10 * 60 * 1000,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: config.accountId,
        CLOUDFLARE_API_TOKEN: config.apiToken,
        NO_COLOR: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        reject(new Error('Wrangler output exceeded the safety limit'));
      }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Cloudflare deployment timed out'));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timeout);
      const secrets = [config.apiToken, config.accountId];
      if (code !== 0) {
        reject(new Error(redact(stderr || stdout || `Wrangler exited with code ${String(code)}`, secrets)));
        return;
      }
      resolve(redact(stdout, secrets));
    });
  });
}

function parseDeploymentUrl(output: string): string {
  const urls = output.match(/https:\/\/[^\s]+\.pages\.dev[^\s]*/g);
  const url = urls?.at(-1)?.replace(/[),.;]+$/, '');
  if (!url) throw new Error('Wrangler completed without returning a deployment URL');
  return url;
}

export async function deployToCloudflarePages(
  distDir: string,
  config: CloudflarePagesConfig,
): Promise<DeploymentResult> {
  const branch = config.branch ?? 'main';
  const output = await runWrangler([
    'pages',
    'deploy',
    distDir,
    '--project-name',
    config.projectName,
    '--branch',
    branch,
    '--commit-dirty=true',
  ], config);

  return {
    success: true,
    url: parseDeploymentUrl(output),
    deploymentId: '',
    environment: branch === 'main' ? 'production' : 'preview',
  };
}

export async function listCloudflareDeployments(
  accountId: string,
  apiToken: string,
  projectName: string,
): Promise<Record<string, unknown>[]> {
  const output = await runWrangler([
    'pages',
    'deployment',
    'list',
    '--project-name',
    projectName,
    '--json',
  ], { accountId, apiToken });
  const parsed = JSON.parse(output) as WranglerDeployment[];
  return parsed.map((deployment) => ({
    id: deployment.id ?? deployment.Id ?? '',
    url: deployment.url ?? deployment.Url ?? '',
    environment: deployment.environment ?? deployment.Environment ?? '',
    createdOn: deployment.created_on ?? deployment.Created ?? '',
  }));
}
