import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { AppDatabase } from './database.js';

const databaseUrl = process.env.DATABASE_MIGRATION_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_MIGRATION_URL is required');
const database = new AppDatabase(databaseUrl, { max: 1 });
try { await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('./drizzle', import.meta.url)) }); }
finally { await database.close(); }
