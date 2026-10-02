import http from 'node:http';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler } from './http.js';
import { attachRealtime } from './realtime.js';
import { general } from './routes/general.js';
import { orders, razorpayWebhook } from './routes/orders.js';
import { adminRouter, partnerRouter } from './routes/staff.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors());
  // Razorpay webhook needs the raw body, so it is mounted before the JSON parser.
  app.use('/webhooks/razorpay', razorpayWebhook);
  app.use(express.json({ limit: '100kb' }));
  app.use('/auth', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
  app.use('/', general);
  app.use('/orders', orders);
  app.use('/admin', adminRouter);
  app.use('/partner', partnerRouter);
  app.use((_req, res) => { res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }); });
  app.use(errorHandler);
  return app;
}

/** HTTP server with the real-time (socket.io) channel attached. */
export function createServer() {
  const server = http.createServer(createApp());
  attachRealtime(server);
  return server;
}

/** Provisions the first admin(s) from env and, in dev auth mode only, two demo delivery partners. */
export async function bootstrap() {
  for (const phone of config.bootstrapAdminPhones) {
    await pool.query("insert into users (phone, role, name) values ($1,'admin','Store Admin') on conflict (phone) do update set role = 'admin'", [phone]);
  }
  if (config.authMode === 'dev') {
    for (const [phone, name] of [['9000000002', 'Staff One'], ['9000000003', 'Staff Two']]) {
      const u = await pool.query("insert into users (phone, role, name) values ($1,'delivery_partner',$2) on conflict (phone) do update set role = 'delivery_partner' returning id", [phone, name]);
      await pool.query('insert into delivery_partners (user_id, is_available) values ($1, true) on conflict do nothing', [u.rows[0].id]);
    }
  }
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  await bootstrap();
  createServer().listen(config.port, () => console.log(`API listening on :${config.port} (auth: ${config.authMode})`));
}
