import { PGlite, type Transaction } from '@electric-sql/pglite';

/**
 * Thin database abstraction so the API and repositories never depend on a
 * concrete driver. Phase 1 ships PGlite (real PostgreSQL compiled to WASM,
 * embedded — no server required in development/test). The production
 * deployment target (a managed PostgreSQL service) remains an open hosting
 * decision (O-34); a `pg`-backed implementation can be added behind this
 * interface without touching repositories or business logic.
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /** Execute one or more SQL statements (no parameters). */
  exec(sql: string): Promise<void>;
  /**
   * Run `fn` inside a database transaction. Commits when `fn` resolves,
   * rolls back when it throws. Nested calls are not supported.
   */
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  driver: 'pglite';
  /** `memory:` for an in-process database, or a filesystem directory path. */
  path: string;
}

const MEMORY_PREFIX = 'memory:';

export function isMemoryPath(path: string): boolean {
  return path === MEMORY_PREFIX || path === '' || path === ':memory:';
}

class PgliteClient implements DbClient {
  private readonly pg: PGlite;
  private readonly inTransaction: boolean;

  constructor(pg: PGlite, inTransaction = false) {
    this.pg = pg;
    this.inTransaction = inTransaction;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pg.query<T>(sql, params as unknown[]);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new Error('Nested database transactions are not supported');
    }
    return this.pg.transaction(async (tx: Transaction) => {
      const wrapped = new PgliteClient(tx as unknown as PGlite, true);
      return fn(wrapped);
    });
  }

  async close(): Promise<void> {
    if (this.inTransaction) return; // closing inside a transaction is a bug; ignore
    await this.pg.close();
  }
}

export async function createDatabase(config: DatabaseConfig): Promise<DbClient> {
  if (config.driver !== 'pglite') {
    throw new Error(`Unsupported database driver: ${String(config.driver)}`);
  }
  const pg = isMemoryPath(config.path) ? new PGlite() : new PGlite(config.path);
  // Open the connection eagerly so migrations fail fast on a bad path.
  await pg.waitReady;
  return new PgliteClient(pg);
}
