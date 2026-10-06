import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { pool } from './db.js';
import { isOriginAllowed } from './security.js';

let io: Server | null = null;

/**
 * Real-time channel for every role. Clients authenticate with the same bearer token as the REST API and are
 * placed in a private room per user (plus an "admins" room), so events only reach the people they concern.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: (origin, cb) => cb(null, isOriginAllowed(origin)) }, pingInterval: 20000, pingTimeout: 20000, maxHttpBufferSize: 100_000 });

  io.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      if (!token) throw new Error('missing token');
      const { phone } = await verifyToken(token);
      const { rows } = await pool.query('select id, role from users where phone = $1', [phone]);
      if (!rows[0]) throw new Error('no account');
      socket.data.userId = rows[0].id;
      socket.data.role = rows[0].role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`);
    if (socket.data.role === 'admin') void socket.join('admins');
    socket.emit('ready', { role: socket.data.role });
  });
  return io;
}

export const emitUser = (userId: string | null | undefined, event: string, payload: unknown) => {
  if (userId) io?.to(`user:${userId}`).emit(event, payload);
};
export const emitAdmins = (event: string, payload: unknown) => { io?.to('admins').emit(event, payload); };

/** Tells everyone involved in an order that it changed so their screens can refresh instantly. */
export function emitOrder(order: { id: string; order_number: string; status: string; customer_id: string; partner_id?: string | null }) {
  const payload = { orderId: order.id, orderNumber: order.order_number, status: order.status };
  emitUser(order.customer_id, 'order:update', payload);
  emitUser(order.partner_id, 'order:update', payload);
  emitAdmins('order:update', payload);
}

export const closeRealtime = () => { void io?.close(); io = null; };

/** A partner's state changed (assigned, riding, back at shop, duty on/off): refresh admin team views and the partner's own screen. */
export function emitPartner(partnerId: string, state: string) {
  const payload = { partnerId, state, isAvailable: state === 'available' };
  emitAdmins('partner:update', payload);
  emitUser(partnerId, 'partner:update', payload);
}
