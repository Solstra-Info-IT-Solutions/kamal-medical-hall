import pg from 'pg';
import { config } from './config.js';

// Keep DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false }, max: 8 });

export type Queryable = Pick<pg.Pool, 'query'>;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
