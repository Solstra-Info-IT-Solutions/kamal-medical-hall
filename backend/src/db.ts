import pg from 'pg';
import { config } from './config.js';
import { requestStats } from './observability.js';

// Keep DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseCa ? { ca: config.databaseCa, rejectUnauthorized: true } : { rejectUnauthorized: false },
  max: 10, idleTimeoutMillis: 5 * 60_000, // keep connections warm: opening one costs ~0.4 s (TLS + pooler login)
   connectionTimeoutMillis: 8_000, keepAlive: true,
  statement_timeout: 15_000, application_name: 'kmh-api',
});

// An idle connection dropped by the pooler must not crash the process; the pool simply opens a new one next time.
pool.on('error', (e) => console.error(JSON.stringify({ level: 'warn', msg: 'idle database connection error', error: e.message })));

/** Adds the time and count of every query to the current request's stats (shown in Server-Timing and the latency log). */
function timed<A extends unknown[], R>(fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return async (...args: A) => {
    const stats = requestStats.getStore();
    const t0 = performance.now();
    try { return await fn(...args); } finally { if (stats) { stats.queries += 1; stats.dbMs += performance.now() - t0; } }
  };
}
const rawPoolQuery = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
(pool as unknown as { query: unknown }).query = timed(rawPoolQuery);

export type Queryable = Pick<pg.Pool, 'query'>;
/** A transaction client that can queue work (e.g. socket events) to run only after the commit succeeds. */
export type TxClient = pg.PoolClient & { afterCommit: (fn: () => void) => void };

export async function tx<T>(fn: (c: TxClient) => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as TxClient;
  (client as unknown as { query: unknown }).query = timed((client.query as (...a: unknown[]) => Promise<unknown>).bind(client));
  const queued: Array<() => void> = [];
  client.afterCommit = (cb) => { queued.push(cb); };
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    for (const cb of queued) { try { cb(); } catch (e) { console.error('afterCommit failed', e); } }
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const hasAfterCommit = (db: unknown): db is TxClient => typeof (db as TxClient)?.afterCommit === 'function';
