import { pool, hasAfterCommit, type Queryable } from './db.js';
import { firebaseMessaging } from './auth.js';
import { emitUser } from './realtime.js';

export async function notify(userId: string, orderId: string | null, type: string, title: string, body: string, db: Queryable = pool) {
  const { rows } = await db.query('insert into notifications (user_id, order_id, type, title, body) values ($1,$2,$3,$4,$5) returning id', [userId, orderId, type, title, body]);
  const deliver = () => {
    emitUser(userId, 'notification', { id: rows[0].id, type, title, body, orderId }); // instant, in-app
    void push(userId, title, body, orderId).catch((e) => console.error('push failed', e)); // background / app closed
  };
  if (hasAfterCommit(db)) db.afterCommit(deliver); else deliver();
}

export async function notifyAdmins(orderId: string | null, type: string, title: string, body: string, db: Queryable = pool) {
  const { rows } = await db.query("select id from users where role = 'admin'");
  for (const row of rows) await notify(row.id, orderId, type, title, body, db);
}

async function push(userId: string, title: string, body: string, orderId: string | null) {
  const messaging = firebaseMessaging();
  if (!messaging) return;
  const { rows } = await pool.query('select token from device_tokens where user_id = $1', [userId]);
  if (!rows.length) return;
  const res = await messaging.sendEachForMulticast({ tokens: rows.map((r) => r.token), notification: { title, body }, data: orderId ? { orderId } : {} });
  const dead = res.responses.flatMap((r, i) => (!r.success && r.error?.code === 'messaging/registration-token-not-registered' ? [rows[i].token] : []));
  if (dead.length) await pool.query('delete from device_tokens where token = any($1)', [dead]);
}
