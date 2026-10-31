
import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';

import { authed, requireRole } from '../auth.js';
import { conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { emitAdmins, emitUser } from '../realtime.js';

import {
  ChatMessage,
  ChatThread,
  type ChatSenderRole,
  type IChatMessage,
  type IChatThread,
} from '../models/Chat.js';

import { User } from '../models/User.js';
import { Order } from '../models/Order.js';

export const chatRouter = Router();
export const chatAdmin = Router();

chatRouter.use(authed, requireRole('customer'));
chatAdmin.use(authed, requireRole('admin'));

const ACTIVE_WINDOW_MIN = 5;
const DEFAULT_HANDLE_MIN = 5;

export interface QueueInfo {
  state: 'active' | 'waiting' | 'closed';
  position: number;
  estimatedMinutes: number;
  adminBusy: boolean;
}

const objectId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id) &&
  new mongoose.Types.ObjectId(id).toString() === id.toLowerCase();

const msgView = (message: IChatMessage) => ({
  id: message._id.toString(),
  threadId: message.threadId.toString(),
  role: message.senderRole,
  body: message.body,
  createdAt: message.createdAt,
});

async function averageHandleMinutes(): Promise<number> {
  const closedThreads = await ChatThread.find({
    status: 'closed',
    closedAt: { $ne: null },
  })
    .sort({ closedAt: -1 })
    .limit(50)
    .select('createdAt closedAt')
    .lean();

  if (closedThreads.length === 0) {
    return DEFAULT_HANDLE_MIN;
  }

  const durations = closedThreads
    .filter((thread) => thread.closedAt)
    .map(
      (thread) =>
        (thread.closedAt!.getTime() - thread.createdAt.getTime()) /
        60_000,
    );

  if (durations.length === 0) {
    return DEFAULT_HANDLE_MIN;
  }

  const average =
    durations.reduce((total, value) => total + value, 0) /
    durations.length;

  return Math.min(20, Math.max(3, Math.round(average)));
}

/** Calculates the current state and queue position for all open chats. */
export async function queueSnapshot() {
  const threads = await ChatThread.find({ status: 'open' })
    .sort({ createdAt: 1 })
    .select('_id customerId status createdAt lastAdminMsgAt')
    .lean();

  const avg = await averageHandleMinutes();
  const activeCutoff =
    Date.now() - ACTIVE_WINDOW_MIN * 60_000;

  const activeThreads = threads.filter(
    (thread) =>
      thread.lastAdminMsgAt != null &&
      thread.lastAdminMsgAt.getTime() > activeCutoff,
  );

  const waitingThreads = threads.filter(
    (thread) =>
      !thread.lastAdminMsgAt ||
      thread.lastAdminMsgAt.getTime() <= activeCutoff,
  );

  const adminBusy = activeThreads.length > 0;

  const map = new Map<
    string,
    QueueInfo & { customerId: string }
  >();

  for (const thread of activeThreads) {
    map.set(thread._id.toString(), {
      customerId: thread.customerId.toString(),
      state: 'active',
      position: 0,
      estimatedMinutes: 0,
      adminBusy,
    });
  }

  waitingThreads.forEach((thread, index) => {
    const position = index + 1;

    const estimatedMinutes = adminBusy
      ? Math.round(position * avg)
      : Math.max(
          1,
          Math.round((position - 1) * avg) || 2,
        );

    map.set(thread._id.toString(), {
      customerId: thread.customerId.toString(),
      state: 'waiting',
      position,
      estimatedMinutes,
      adminBusy,
    });
  });

  return {
    map,
    adminBusy,
    waitingCount: waitingThreads.length,
    activeCount: activeThreads.length,
  };
}

/** Broadcasts updated queue positions to customers and admins. */
export async function broadcastQueue(): Promise<void> {
  const snapshot = await queueSnapshot();

  for (const [threadId, queue] of snapshot.map) {
    emitUser(queue.customerId, 'chat:queue', {
      threadId,
      ...queue,
      customerId: undefined,
    });
  }

  emitAdmins('chat:update', {
    adminBusy: snapshot.adminBusy,
    waiting: snapshot.waitingCount,
  });
}

async function openThread(
  customerId: string,
): Promise<IChatThread | null> {
  return ChatThread.findOne({
    customerId,
    status: 'open',
  });
}

function botText(queue: QueueInfo): string | null {
  if (queue.state === 'active') return null;

  if (!queue.adminBusy && queue.position <= 1) {
    return 'Thanks for writing to us. Your message has reached the shop and the shopkeeper will reply shortly.';
  }

  return `Thanks for writing to us. The shopkeeper is helping another customer right now. You are number ${queue.position} in the queue. Estimated waiting time: about ${Math.max(queue.estimatedMinutes, 1)} minute${queue.estimatedMinutes === 1 ? '' : 's'}. You can keep typing; your messages are saved.`;
}

async function createMessage(
  threadId: mongoose.Types.ObjectId,
  senderId: string | null,
  senderRole: ChatSenderRole,
  body: string,
): Promise<IChatMessage> {
  const [message] = await ChatMessage.create([
    {
      threadId,
      senderId: senderId
        ? new mongoose.Types.ObjectId(senderId)
        : null,
      senderRole,
      body,
    },
  ]);

  return message;
}

// ============================================================
// Customer
// ============================================================

chatRouter.get('/thread', async (req, res) => {
  let thread = await openThread(req.user!.id);

  if (!thread) {
    thread = await ChatThread.findOne({
      customerId: req.user!.id,
    }).sort({ createdAt: -1 });
  }

  if (!thread) {
    res.json({
      thread: null,
      messages: [],
      queue: null,
    });
    return;
  }

  const messages = await ChatMessage.find({
    threadId: thread._id,
  }).sort({ createdAt: 1 });

  let queue: QueueInfo | null = null;

  if (thread.status === 'open') {
    const snapshot = await queueSnapshot();
    const current = snapshot.map.get(thread._id.toString());

    if (current) {
      queue = {
        state: current.state,
        position: current.position,
        estimatedMinutes: current.estimatedMinutes,
        adminBusy: current.adminBusy,
      };
    }
  } else {
    queue = {
      state: 'closed',
      position: 0,
      estimatedMinutes: 0,
      adminBusy: false,
    };
  }

  res.json({
    thread: {
      id: thread._id.toString(),
      status: thread.status,
      orderId: thread.orderId?.toString() ?? null,
      createdAt: thread.createdAt,
    },
    messages: messages.map(msgView),
    queue,
  });
});

chatRouter.post('/messages', async (req, res) => {
  const body = parse(
    z.object({
      body: z.string().trim().min(1).max(1000),
      orderId: z.string().optional(),
    }),
    req.body,
  );

  if (body.orderId && !objectId(body.orderId)) {
    throw notFound('Order not found');
  }

  let thread = await openThread(req.user!.id);
  let created = false;

  if (!thread) {
    let orderId: mongoose.Types.ObjectId | null = null;

    if (body.orderId) {
      const order = await Order.findOne({
        _id: body.orderId,
        customerId: req.user!.id,
      }).select('_id');

      orderId = order?._id ?? null;
    }

    try {
      thread = await ChatThread.create({
        customerId: new mongoose.Types.ObjectId(req.user!.id),
        orderId,
        subject: body.body.slice(0, 80),
        status: 'open',
        lastMessageAt: new Date(),
      });

      created = true;
    } catch (error) {
      // Concurrent requests may both try to open a conversation.
      if (
        (error as { code?: number })?.code !== 11000
      ) {
        throw error;
      }

      thread = await openThread(req.user!.id);
    }
  }

  if (!thread) {
    throw conflict(
      'Could not start the chat. Please try again.',
      'chat_failed',
    );
  }

  const wasQuiet = thread.adminUnread === 0;

  const message = await createMessage(
    thread._id,
    req.user!.id,
    'customer',
    body.body,
  );

  await ChatThread.updateOne(
    { _id: thread._id, status: 'open' },
    {
      $set: { lastMessageAt: new Date() },
      $inc: { adminUnread: 1 },
    },
  );

  const output = [msgView(message)];

  emitUser(req.user!.id, 'chat:message', msgView(message));

  emitAdmins('chat:message', {
    ...msgView(message),
    customerName: req.user!.name,
  });

  if (created) {
    const snapshot = await queueSnapshot();
    const queue = snapshot.map.get(thread._id.toString());
    const automaticReply = queue ? botText(queue) : null;

    if (automaticReply) {
      const botMessage = await createMessage(
        thread._id,
        null,
        'bot',
        automaticReply,
      );

      output.push(msgView(botMessage));

      emitUser(
        req.user!.id,
        'chat:message',
        msgView(botMessage),
      );
    }

    await notifyAdmins(
      null,
      'chat_new',
      'New customer chat',
      `${req.user!.name ?? 'A customer'}: ${body.body.slice(0, 100)}`,
    );
  } else if (wasQuiet) {
    await notifyAdmins(
      null,
      'chat_message',
      'New chat message',
      `${req.user!.name ?? 'A customer'}: ${body.body.slice(0, 100)}`,
    );
  }

  await broadcastQueue();

  res.status(201).json({
    messages: output,
  });
});

chatRouter.post('/read', async (req, res) => {
  await ChatThread.updateMany(
    {
      customerId: req.user!.id,
      status: 'open',
    },
    {
      $set: { customerUnread: 0 },
    },
  );

  res.status(204).end();
});

/** Customer closes their current conversation. */
chatRouter.post('/close', async (req, res) => {
  const thread = await openThread(req.user!.id);

  if (!thread) {
    res.status(204).end();
    return;
  }

  const updated = await ChatThread.updateOne(
    {
      _id: thread._id,
      status: 'open',
    },
    {
      $set: {
        status: 'closed',
        closedAt: new Date(),
      },
    },
  );

  if (updated.modifiedCount === 0) {
    res.status(204).end();
    return;
  }

  const botMessage = await createMessage(
    thread._id,
    null,
    'bot',
    'This chat was closed. Write to us again any time you need help.',
  );

  emitUser(
    req.user!.id,
    'chat:message',
    msgView(botMessage),
  );

  emitAdmins(
    'chat:message',
    msgView(botMessage),
  );

  await broadcastQueue();

  res.status(204).end();
});

// ============================================================
// Admin
// ============================================================

chatAdmin.get('/chat/summary', async (_req, res) => {
  const snapshot = await queueSnapshot();

  const unreadResult = await ChatThread.aggregate([
    { $match: { status: 'open' } },
    {
      $group: {
        _id: null,
        unread: { $sum: '$adminUnread' },
      },
    },
  ]);

  const unread = unreadResult[0]?.unread ?? 0;

  res.json({
    open: snapshot.activeCount + snapshot.waitingCount,
    waiting: snapshot.waitingCount,
    active: snapshot.activeCount,
    unread: Number(unread),
    busy: snapshot.adminBusy,
  });
});

chatAdmin.get('/chat/threads', async (req, res) => {
  const { status } = parse(
    z.object({
      status: z.enum(['open', 'closed']).default('open'),
    }),
    req.query,
  );

  const threads = await ChatThread.find({ status })
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .lean();

  const threadIds = threads.map((thread) => thread._id);
  const customerIds = threads.map((thread) => thread.customerId);
  const orderIds = threads
    .map((thread) => thread.orderId)
    .filter((id): id is mongoose.Types.ObjectId => id != null);

  const [users, orders, messages, snapshot] = await Promise.all([
    User.find({ _id: { $in: customerIds } })
      .select('_id name phone')
      .lean(),

    Order.find({ _id: { $in: orderIds } })
      .select('_id orderNumber')
      .lean(),

    ChatMessage.find({ threadId: { $in: threadIds } })
      .sort({ createdAt: -1 })
      .lean(),

    queueSnapshot(),
  ]);

  const userMap = new Map(
    users.map((user) => [user._id.toString(), user]),
  );

  const orderMap = new Map(
    orders.map((order) => [order._id.toString(), order]),
  );

  const latestMessageMap = new Map<
    string,
    (typeof messages)[number]
  >();

  for (const message of messages) {
    const key = message.threadId.toString();

    if (!latestMessageMap.has(key)) {
      latestMessageMap.set(key, message);
    }
  }

  res.json({
    adminBusy: snapshot.adminBusy,
    threads: threads.map((thread) => {
      const id = thread._id.toString();
      const customer = userMap.get(thread.customerId.toString());
      const order = thread.orderId
        ? orderMap.get(thread.orderId.toString())
        : undefined;
      const lastMessage = latestMessageMap.get(id);
      const queue = snapshot.map.get(id);

      return {
        id,
        status: thread.status,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        orderNumber: order?.orderNumber ?? null,
        subject: thread.subject,
        lastBody: lastMessage?.body ?? null,
        lastMessageAt: thread.lastMessageAt,
        unread: thread.adminUnread,
        state: queue?.state ?? 'closed',
        position: queue?.position ?? 0,
      };
    }),
  });
});

chatAdmin.get('/chat/threads/:id', async (req, res) => {
  const id = String(req.params.id);

  if (!objectId(id)) {
    throw notFound('Chat not found');
  }

  const thread = await ChatThread.findById(id);

  if (!thread) {
    throw notFound('Chat not found');
  }

  const [customer, order, messages] = await Promise.all([
    User.findById(thread.customerId)
      .select('_id name phone')
      .lean(),

    thread.orderId
      ? Order.findById(thread.orderId)
          .select('_id orderNumber')
          .lean()
      : null,

    ChatMessage.find({ threadId: thread._id })
      .sort({ createdAt: 1 }),
  ]);

  await ChatThread.updateOne(
    { _id: thread._id },
    { $set: { adminUnread: 0 } },
  );

  res.json({
    thread: {
      id: thread._id.toString(),
      status: thread.status,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      orderId: thread.orderId?.toString() ?? null,
      orderNumber: order?.orderNumber ?? null,
      customerId: thread.customerId.toString(),
    },
    messages: messages.map(msgView),
  });
});

chatAdmin.post('/chat/threads/:id/messages', async (req, res) => {
  const id = String(req.params.id);

  if (!objectId(id)) {
    throw notFound('Chat not found');
  }

  const body = parse(
    z.object({
      body: z.string().trim().min(1).max(1000),
    }),
    req.body,
  );

  const thread = await ChatThread.findById(id);

  if (!thread) {
    throw notFound('Chat not found');
  }

  if (thread.status !== 'open') {
    throw conflict('This chat is closed.', 'chat_closed');
  }

  const message = await createMessage(
    thread._id,
    req.user!.id,
    'admin',
    body.body,
  );

  await ChatThread.updateOne(
    {
      _id: thread._id,
      status: 'open',
    },
    {
      $set: {
        lastMessageAt: new Date(),
        lastAdminMsgAt: new Date(),
        adminUnread: 0,
      },
      $inc: {
        customerUnread: 1,
      },
    },
  );

  const messageView = msgView(message);

  emitUser(
    thread.customerId.toString(),
    'chat:message',
    messageView,
  );

  emitAdmins('chat:message', messageView);

  await notify(
    thread.customerId.toString(),
    null,
    'chat_reply',
    'Reply from the shop',
    body.body.slice(0, 120),
  );

  await broadcastQueue();

  res.status(201).json({
    message: messageView,
  });
});

chatAdmin.post('/chat/threads/:id/close', async (req, res) => {
  const id = String(req.params.id);

  if (!objectId(id)) {
    throw notFound('Open chat not found');
  }

  const thread = await ChatThread.findOneAndUpdate(
    {
      _id: id,
      status: 'open',
    },
    {
      $set: {
        status: 'closed',
        closedAt: new Date(),
        adminUnread: 0,
      },
    },
    { returnDocument: 'after' },
  );

  if (!thread) {
    throw notFound('Open chat not found');
  }

  const botMessage = await createMessage(
    thread._id,
    null,
    'bot',
    'The shopkeeper closed this chat. Write to us again any time you need help.',
  );

  const messageView = msgView(botMessage);

  emitUser(
    thread.customerId.toString(),
    'chat:message',
    messageView,
  );

  emitAdmins('chat:message', messageView);

  await broadcastQueue();

  res.status(204).end();
});
