import { pool } from '../src/db.js';

/**
 * Most order tests walk through the customer accepting the amount. The real store may have that page switched off,
 * so these tests switch it on while they run and put the store's setting back afterwards.
 */
export async function withAcceptPage(on = true): Promise<() => Promise<void>> {
  const was = (await pool.query('select customer_accept_required from store_settings where id = 1')).rows[0]?.customer_accept_required ?? true;
  await pool.query('update store_settings set customer_accept_required = $1 where id = 1', [on]);
  return async () => { await pool.query('update store_settings set customer_accept_required = $1 where id = 1', [was]); };
}
