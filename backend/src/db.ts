import pg from 'pg';
import { config } from './config.js';

// Keep DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false }, max: 8 });

export type Queryable = Pick<pg.Pool, 'query'>;
/** A transaction client that can queue work (e.g. socket events) to run only after the commit succeeds. */
export type TxClient = pg.PoolClient & { afterCommit: (fn: () => void) => void };

export async function tx<T>(fn: (c: TxClient) => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as TxClient;
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
