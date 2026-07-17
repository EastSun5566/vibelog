import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm/relations';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core/dialect';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3/driver';

// Drizzle 0.45.2 has no node:sqlite export, so this adapts DatabaseSync to its
// synchronous session without loading the native better-sqlite3 package.

function valuesStatement(connection: DatabaseSync, source: string): StatementSync {
  const statement = connection.prepare(source);
  statement.setReturnArrays(true);
  return statement;
}

function transaction(connection: DatabaseSync, callback: (...params: unknown[]) => unknown) {
  const run = (behavior: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE', params: unknown[]) => {
    connection.exec(`BEGIN ${behavior}`);
    try {
      const result = callback(...params);
      connection.exec('COMMIT');
      return result;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  };
  const deferred = (...params: unknown[]) => run('DEFERRED', params);
  return Object.assign(deferred, {
    deferred,
    immediate: (...params: unknown[]) => run('IMMEDIATE', params),
    exclusive: (...params: unknown[]) => run('EXCLUSIVE', params),
  });
}

export function drizzleNodeSqlite<TSchema extends Record<string, unknown>>(connection: DatabaseSync, fullSchema: TSchema): BetterSQLite3Database<TSchema> {
  const dialect = new SQLiteSyncDialect();
  const tablesConfig = extractTablesRelationalConfig(fullSchema, createTableRelationsHelpers);
  const relationalSchema = {
    fullSchema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  };
  const client = {
    prepare(source: string) {
      const statement = connection.prepare(source);
      return {
        run: (...params: unknown[]) => statement.run(...params as SQLInputValue[]),
        all: (...params: unknown[]) => statement.all(...params as SQLInputValue[]),
        get: (...params: unknown[]) => statement.get(...params as SQLInputValue[]),
        raw: () => {
          const raw = valuesStatement(connection, source);
          return {
            run: (...params: unknown[]) => raw.run(...params as SQLInputValue[]),
            all: (...params: unknown[]) => raw.all(...params as SQLInputValue[]),
            get: (...params: unknown[]) => raw.get(...params as SQLInputValue[]),
            raw() { return this; },
          };
        },
      };
    },
    transaction: (callback: (...params: unknown[]) => unknown) => transaction(connection, callback),
  };
  const session = new BetterSQLiteSession(client as never, dialect, relationalSchema);
  return new BaseSQLiteDatabase('sync', dialect, session, relationalSchema) as BetterSQLite3Database<TSchema>;
}
