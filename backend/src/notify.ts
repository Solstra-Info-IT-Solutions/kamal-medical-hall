import { pool, hasAfterCommit, type Queryable } from './db.js';
import { firebaseMessaging } from './auth.js';
import { emitUser } from './realtime.js';

export async function notify(userId: string, orderId: string | null, type: string, title: string, body: string, db: Queryable = pool) {
  const { rows } = await db.query('insert into notifications (user_id, order_id, type, title, body) values ($1,$2,$3,$4,$5) returning id', [userId, orderId, type, title, body]);
  const deliver = () => {
    emitUser(userId, 'notification', { id: rows[0].id, type, title, body, orderId }); // instant, in-app
    void push(userId, title, body, orderId, type).catch((e) => console.error('push failed', e)); // background / app closed
  };
  if (hasAfterCommit(db)) db.afterCommit(deliver); else deliver();
}

/** One notification to many people (store open/close announcements). */
export async function notifyMany(userIds: string[], type: string, title: string, body: string, db: Queryable = pool) {
  if (!userIds.length) return;
  const { rows } = await db.query('insert into notifications (user_id, order_id, type, title, body) select u, null, $2, $3, $4 from unnest($1::uuid[]) as u returning id, user_id', [userIds, type, title, body]);
  const deliver = () => {
    for (const r of rows) {
      emitUser(r.user_id, 'notification', { id: r.id, type, title, body, orderId: null });
      void push(r.user_id, title, body, null, type).catch((e) => console.error('push failed', e));
    }
  };
  if (hasAfterCommit(db)) db.afterCommit(deliver); else deliver();
}

export async function notifyAdmins(orderId: string | null, type: string, title: string, body: string, db: Queryable = pool) {
  const { rows } = await db.query("select id from users where role = 'admin'");
  for (const row of rows) await notify(row.id, orderId, type, title, body, db);
}

/** Sends the phone notification (app closed or in the background). Android: high priority so it arrives even in Doze. */
async function push(userId: string, title: string, body: string, orderId: string | null, type = '') {
  const messaging = firebaseMessaging();
  if (!messaging) return;
  const { rows } = await pool.query('select token from device_tokens where user_id = $1', [userId]);
  if (!rows.length) return;
  const res = await messaging.sendEachForMulticast({
    tokens: rows.map((r) => r.token),
    notification: { title, body },
    data: { ...(orderId ? { orderId } : {}), ...(type ? { type } : {}) },
    android: { priority: 'high', ttl: 24 * 3600 * 1000, notification: { sound: 'default', defaultVibrateTimings: true } },
    apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
  });
  const failed = res.responses.filter((r) => !r.success);
  if (failed.length) console.error(JSON.stringify({ level: 'error', msg: 'push not delivered', failed: failed.length, of: rows.length, codes: [...new Set(failed.map((r) => r.error?.code))] }));
  const dead = res.responses.flatMap((r, i) => (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code ?? '') ? [rows[i].token] : []));
  if (dead.length) await pool.query('delete from device_tokens where token = any($1)', [dead]);
}
