// Structural types used by Drizzle's synchronous session; no native better-sqlite3 package is installed.
declare module 'better-sqlite3' {
  export interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    run(...params: unknown[]): RunResult;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    raw(): Statement;
  }

  export interface Transaction {
    (...params: unknown[]): unknown;
    deferred(...params: unknown[]): unknown;
    immediate(...params: unknown[]): unknown;
    exclusive(...params: unknown[]): unknown;
  }

  export interface Database {
    prepare(source: string): Statement;
    transaction(callback: (...params: unknown[]) => unknown): Transaction;
  }

  export interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
  }

  const Database: new(source?: string | Buffer, options?: Options) => Database;
  export default Database;
}
