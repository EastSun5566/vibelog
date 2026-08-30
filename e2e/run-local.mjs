import { execFileSync } from 'node:child_process';

const offset = process.pid % 10_000;
const project = `vibelog-e2e-${String(process.pid)}`;
const appImage = 'vibelog-app:e2e';
const appPort = 20_000 + offset;
const postgresPort = 30_000 + offset;
const minioPort = 40_000 + offset;
const minioConsolePort = 50_000 + offset;
const mailpitPort = 60_000 + (offset % 5_000);
const appOrigin = `http://app.localtest.me:${String(appPort)}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  VIBELOG_APP_IMAGE: appImage,
  APP_ORIGIN: appOrigin,
  HACKMD_BASE_URL: 'http://hackmd-fixture:4400',
  PORT: String(appPort),
  POSTGRES_PORT: String(postgresPort),
  MINIO_PORT: String(minioPort),
  MINIO_CONSOLE_PORT: String(minioConsolePort),
  MAILPIT_PORT: String(mailpitPort),
  E2E_APP_ORIGIN: appOrigin,
  E2E_MAILPIT_URL: `http://127.0.0.1:${String(mailpitPort)}`,
};

/** @param {string} command @param {string[]} args @param {import('node:child_process').ExecFileSyncOptions} [options] */
function run(command, args, options = {}) {
  return execFileSync(command, args, { env: environment, stdio: 'inherit', ...options });
}

/** @param {number} milliseconds */
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForWeb() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${appOrigin}/health`)).ok) return;
    } catch {
      // The stack may still be starting.
    }
    await sleep(1_000);
  }
  throw new Error(`VibeLog did not become healthy at ${appOrigin}`);
}

let failed = false;
try {
  run('docker', ['compose', '--profile', 'e2e', 'build', 'migrate']);
  run('docker', ['compose', '--profile', 'e2e', 'up', '--detach']);
  await waitForWeb();
  run('pnpm', ['exec', 'playwright', 'test']);
} catch (error) {
  failed = true;
  try { run('docker', ['compose', '--profile', 'e2e', 'logs', '--no-color']); }
  catch {
    // Preserve the original test or startup failure when logs are unavailable.
  }
  console.error(error instanceof Error ? error.message : error);
} finally {
  try { run('docker', ['compose', '--profile', 'e2e', 'down', '--volumes', '--remove-orphans']); }
  catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed) process.exitCode = 1;
