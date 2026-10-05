import { Router } from 'express';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { emitAdmins, emitUser } from '../realtime.js';

/**
 * Live chat between customers and the shopkeeper.
 *
 * One open conversation per customer. The shopkeeper can only really talk to one person at a time, so a
 * conversation is "active" while the shopkeeper has written in it during the last 5 minutes; everyone else who
 * wrote in the meantime is "waiting" and is told their place in the queue and an estimated waiting time.
 */
export const chatRouter = Router();
export const chatAdmin = Router();
chatRouter.use(authed, requireRole('customer'));
chatAdmin.use(authed, requireRole('admin'));

const ACTIVE_WINDOW_MIN = 5;
const DEFAULT_HANDLE_MIN = 5;

export interface QueueInfo { state: 'active' | 'waiting' | 'closed'; position: number; estimatedMinutes: number; adminBusy: boolean }

/** Average time (minutes) a finished conversation took, kept between 3 and 20 so the estimate stays sensible. */
async function averageHandleMinutes() {
  const { rows } = await pool.query(`select avg(extract(epoch from (closed_at - created_at)) / 60) as m
    from (select created_at, closed_at from chat_threads where status = 'closed' and closed_at is not null order by closed_at desc limit 50) x`);
  const m = rows[0]?.m == null ? DEFAULT_HANDLE_MIN : Number(rows[0].m);
  return Math.min(20, Math.max(3, Math.round(m)));
}

/** Where every open conversation stands right now (one query for the whole queue). */
export async function queueSnapshot() {
  const { rows } = await pool.query(
    `select id, customer_id, status, created_at, last_admin_msg_at,
            (last_admin_msg_at is not null and last_admin_msg_at > now() - ($1 || ' minutes')::interval) as active
     from chat_threads where status = 'open' order by created_at`, [String(ACTIVE_WINDOW_MIN)]);
  const avg = await averageHandleMinutes();
  const activeCount = rows.filter((r) => r.active).length;
  const adminBusy = activeCount > 0;
  const waiting = rows.filter((r) => !r.active);
  const map = new Map<string, QueueInfo & { customerId: string }>();
  for (const r of rows) {
    if (r.active) { map.set(r.id, { customerId: r.customer_id, state: 'active', position: 0, estimatedMinutes: 0, adminBusy }); continue; }
    const position = waiting.findIndex((w) => w.id === r.id) + 1;
    // The shopkeeper finishes the active chat first (about `avg` minutes), then each person ahead of you.
    const estimatedMinutes = adminBusy ? Math.round(position * avg) : Math.max(1, Math.round((position - 1) * avg) || 2);
    map.set(r.id, { customerId: r.customer_id, state: 'waiting', position, estimatedMinutes, adminBusy });
  }
  return { map, adminBusy, waitingCount: waiting.length, activeCount };
}

/** Pushes the fresh queue position to every waiting customer and refreshes the admin's list. */
export async function broadcastQueue() {
  const snap = await queueSnapshot();
  for (const [threadId, q] of snap.map) emitUser(q.customerId, 'chat:queue', { threadId, ...q, customerId: undefined });
  emitAdmins('chat:update', { adminBusy: snap.adminBusy, waiting: snap.waitingCount });
}

const msgView = (m: Record<string, any>) => ({ id: m.id, threadId: m.thread_id, role: m.sender_role, body: m.body, createdAt: m.created_at });

async function openThread(customerId: string) {
  const { rows } = await pool.query("select * from chat_threads where customer_id = $1 and status = 'open'", [customerId]);
  return rows[0] as Record<string, any> | undefined;
}

function botText(q: QueueInfo) {
  if (q.state === 'active') return null;
  if (!q.adminBusy && q.position <= 1) return 'Thanks for writing to us. Your message has reached the shop and the shopkeeper will reply shortly.';
  return `Thanks for writing to us. The shopkeeper is helping another customer right now. You are number ${q.position} in the queue. Estimated waiting time: about ${Math.max(q.estimatedMinutes, 1)} minute${q.estimatedMinutes === 1 ? '' : 's'}. You can keep typing; your messages are saved.`;
}

// ============================================================ Customer
/** The customer's current conversation (or their latest finished one) with all messages and the queue position. */
chatRouter.get('/thread', async (req, res) => {
  let thread = await openThread(req.user!.id);
  if (!thread) thread = (await pool.query("select * from chat_threads where customer_id = $1 order by created_at desc limit 1", [req.user!.id])).rows[0];
  if (!thread) return res.json({ thread: null, messages: [], queue: null });
  const messages = (await pool.query('select * from chat_messages where thread_id = $1 order by created_at', [thread.id])).rows;
  let queue: QueueInfo | null = null;
  if (thread.status === 'open') {
    const q = (await queueSnapshot()).map.get(thread.id);
    if (q) queue = { state: q.state, position: q.position, estimatedMinutes: q.estimatedMinutes, adminBusy: q.adminBusy };
  } else queue = { state: 'closed', position: 0, estimatedMinutes: 0, adminBusy: false };
  res.json({ thread: { id: thread.id, status: thread.status, orderId: thread.order_id, createdAt: thread.created_at }, messages: messages.map(msgView), queue });
});

chatRouter.post('/messages', async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(1000), orderId: z.string().uuid().optional() }), req.body);
  let thread = await openThread(req.user!.id);
  let created = false;
  if (!thread) {
    let orderId: string | null = null;
    if (b.orderId) {
      const o = await pool.query('select id from orders where id = $1 and customer_id = $2', [b.orderId, req.user!.id]);
      orderId = o.rows[0]?.id ?? null;
    }
    try {
      thread = (await pool.query('insert into chat_threads (customer_id, order_id, subject) values ($1,$2,$3) returning *', [req.user!.id, orderId, b.body.slice(0, 80)])).rows[0];
      created = true;
    } catch { thread = await openThread(req.user!.id); } // two taps at once: the other request won
  }
  if (!thread) throw conflict('Could not start the chat. Please try again.', 'chat_failed');
  const wasQuiet = Number(thread.admin_unread) === 0;
  const msg = (await pool.query('insert into chat_messages (thread_id, sender_id, sender_role, body) values ($1,$2,$3,$4) returning *', [thread.id, req.user!.id, 'customer', b.body])).rows[0];
  await pool.query('update chat_threads set last_message_at = now(), admin_unread = admin_unread + 1 where id = $1', [thread.id]);
  const out = [msgView(msg)];
  emitUser(req.user!.id, 'chat:message', msgView(msg));
  emitAdmins('chat:message', { ...msgView(msg), customerName: req.user!.name });

  // The first message of a conversation gets an automatic reply that says where the customer stands in the queue.
  if (created) {
    const q = (await queueSnapshot()).map.get(thread.id);
    const text = q ? botText(q) : null;
    if (text) {
      const bot = (await pool.query('insert into chat_messages (thread_id, sender_role, body) values ($1,$2,$3) returning *', [thread.id, 'bot', text])).rows[0];
      out.push(msgView(bot));
      emitUser(req.user!.id, 'chat:message', msgView(bot));
    }
    await notifyAdmins(null, 'chat_new', 'New customer chat', `${req.user!.name ?? 'A customer'}: ${b.body.slice(0, 100)}`);
  } else if (wasQuiet) {
    await notifyAdmins(null, 'chat_message', 'New chat message', `${req.user!.name ?? 'A customer'}: ${b.body.slice(0, 100)}`);
  }
  await broadcastQueue();
  res.status(201).json({ messages: out });
});

chatRouter.post('/read', async (req, res) => {
  await pool.query("update chat_threads set customer_unread = 0 where customer_id = $1 and status = 'open'", [req.user!.id]);
  res.status(204).end();
});

/** The customer is done (or solved it themselves). */
chatRouter.post('/close', async (req, res) => {
  const thread = await openThread(req.user!.id);
  if (!thread) return res.status(204).end();
  await pool.query("update chat_threads set status = 'closed', closed_at = now() where id = $1", [thread.id]);
  const bot = (await pool.query('insert into chat_messages (thread_id, sender_role, body) values ($1,$2,$3) returning *', [thread.id, 'bot', 'This chat was closed. Write to us again any time you need help.'])).rows[0];
  emitUser(req.user!.id, 'chat:message', msgView(bot));
  emitAdmins('chat:message', msgView(bot));
  await broadcastQueue();
  res.status(204).end();
});

// ============================================================ Admin
chatAdmin.get('/chat/summary', async (_req, res) => {
  const snap = await queueSnapshot();
  const unread = (await pool.query("select coalesce(sum(admin_unread),0) as n from chat_threads where status = 'open'")).rows[0].n;
  res.json({ open: snap.activeCount + snap.waitingCount, waiting: snap.waitingCount, active: snap.activeCount, unread: Number(unread), busy: snap.adminBusy });
});

chatAdmin.get('/chat/threads', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['open', 'closed']).default('open') }), req.query);
  const { rows } = await pool.query(
    `select t.*, u.name as customer_name, u.phone as customer_phone, o.order_number,
            (select body from chat_messages m where m.thread_id = t.id order by created_at desc limit 1) as last_body
     from chat_threads t join users u on u.id = t.customer_id left join orders o on o.id = t.order_id
     where t.status = $1 order by t.last_message_at desc limit 100`, [status]);
  const snap = await queueSnapshot();
  res.json({
    adminBusy: snap.adminBusy,
    threads: rows.map((t) => {
      const q = snap.map.get(t.id);
      return { id: t.id, status: t.status, customerName: t.customer_name, customerPhone: t.customer_phone, orderNumber: t.order_number, subject: t.subject,
        lastBody: t.last_body, lastMessageAt: t.last_message_at, unread: t.admin_unread, state: q?.state ?? 'closed', position: q?.position ?? 0 };
    }),
  });
});

chatAdmin.get('/chat/threads/:id', async (req, res) => {
  const t = (await pool.query(
    `select t.*, u.name as customer_name, u.phone as customer_phone, o.order_number from chat_threads t join users u on u.id = t.customer_id
     left join orders o on o.id = t.order_id where t.id = $1`, [req.params.id])).rows[0];
  if (!t) throw notFound('Chat not found');
  await pool.query('update chat_threads set admin_unread = 0 where id = $1', [t.id]);
  const messages = (await pool.query('select * from chat_messages where thread_id = $1 order by created_at', [t.id])).rows;
  res.json({ thread: { id: t.id, status: t.status, customerName: t.customer_name, customerPhone: t.customer_phone, orderId: t.order_id, orderNumber: t.order_number, customerId: t.customer_id }, messages: messages.map(msgView) });
});

chatAdmin.post('/chat/threads/:id/messages', async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(1000) }), req.body);
  const t = (await pool.query('select * from chat_threads where id = $1', [req.params.id])).rows[0];
  if (!t) throw notFound('Chat not found');
  if (t.status !== 'open') throw conflict('This chat is closed.', 'chat_closed');
  const msg = (await pool.query('insert into chat_messages (thread_id, sender_id, sender_role, body) values ($1,$2,$3,$4) returning *', [t.id, req.user!.id, 'admin', b.body])).rows[0];
  await pool.query('update chat_threads set last_message_at = now(), last_admin_msg_at = now(), admin_unread = 0, customer_unread = customer_unread + 1 where id = $1', [t.id]);
  emitUser(t.customer_id, 'chat:message', msgView(msg));
  emitAdmins('chat:message', msgView(msg));
  await notify(t.customer_id, null, 'chat_reply', 'Reply from the shop', b.body.slice(0, 120));
  await broadcastQueue();
  res.status(201).json({ message: msgView(msg) });
});

chatAdmin.post('/chat/threads/:id/close', async (req, res) => {
  const t = (await pool.query("update chat_threads set status = 'closed', closed_at = now(), admin_unread = 0 where id = $1 and status = 'open' returning *", [req.params.id])).rows[0];
  if (!t) throw notFound('Open chat not found');
  const bot = (await pool.query('insert into chat_messages (thread_id, sender_role, body) values ($1,$2,$3) returning *', [t.id, 'bot', 'The shopkeeper closed this chat. Write to us again any time you need help.'])).rows[0];
  emitUser(t.customer_id, 'chat:message', msgView(bot));
  emitAdmins('chat:message', msgView(bot));
  await broadcastQueue();
  res.status(204).end();
});
