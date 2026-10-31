
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { User } from './models/User.js';
import { attachRpc } from './rpc.js';
import { isOriginAllowed } from './security.js';

let io: Server | null = null;

/**
 * Real-time channel for every role.
 *
 * Clients authenticate with the same bearer token as the REST API
 * and are placed in a private room per user, plus an "admins" room.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
    },
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 100_000,
  });

  /**
   * A connection may be anonymous before sign-in.
   * Anonymous connections join no private rooms.
   *
   * A token that is present but invalid is refused.
   */
  io.use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token ?? '');

    if (!token) return next();

    try {
      const { phone } = await verifyToken(token);

      const user = await User.findOne({ phone })
        .select('_id role')
        .lean();

      if (user) {
        socket.data.userId = user._id.toString();
        socket.data.role = user.role;
      }

      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.userId) {
      void socket.join(`user:${socket.data.userId}`);

      if (socket.data.role === 'admin') {
        void socket.join('admins');
      }
    }

    attachRpc(socket, server);

    socket.emit('ready', {
      role: socket.data.role ?? null,
    });
  });

  return io;
}

export const emitUser = (
  userId: string | null | undefined,
  event: string,
  payload: unknown,
) => {
  if (userId) {
    io?.to(`user:${userId}`).emit(event, payload);
  }
};

/** A refresh signal for every connected app. */
export const emitEveryone = (event: string, payload: unknown) => {
  io?.emit(event, payload);
};

export const emitAdmins = (event: string, payload: unknown) => {
  io?.to('admins').emit(event, payload);
};

/** Tells everyone involved in an order that it changed. */
export function emitOrder(order: {
  id: string;
  order_number: string;
  status: string;
  customer_id: string;
  partner_id?: string | null;
}) {
  const payload = {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
  };

  emitUser(order.customer_id, 'order:update', payload);
  emitUser(order.partner_id, 'order:update', payload);
  emitAdmins('order:update', payload);
}

export const closeRealtime = () => {
  void io?.close();
  io = null;
};

/**
 * A partner's state changed.
 * Refresh admin team views and the partner's own screen.
 */
export function emitPartner(partnerId: string, state: string) {
  const payload = {
    partnerId,
    state,
    isAvailable: state === 'available',
  };

  emitAdmins('partner:update', payload);
  emitUser(partnerId, 'partner:update', payload);
}
