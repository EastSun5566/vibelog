import { loadAppConfig } from './config.js';
import { AppDatabase } from './database.js';
import { OperationWorker } from './jobs.js';

const config = loadAppConfig();
const database = new AppDatabase(config.dataRoot);
const worker = new OperationWorker(database, config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { worker.stop(); });
}

try {
  await worker.run();
} finally {
  database.close();
}
