import { loadAppConfig } from './config.js';
import { AppDatabase } from './database.js';
import { JobWorker } from './jobs.js';

const config = loadAppConfig();
const database = new AppDatabase(config.dataRoot);
const worker = new JobWorker(database, config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { worker.stop(); });
}

await worker.run();
database.close();
