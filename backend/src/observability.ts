import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { reportError } from './monitoring.js';

/** Per-request counters filled in by the database layer (see db.ts). */
export interface RequestStats { queries: number; dbMs: number }
export const requestStats = new AsyncLocalStorage<RequestStats>();

const SLOW_MS = 800;
const SAMPLES = 300;
const latency = new Map<string, number[]>();

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

/** p50 / p95 / p99 per route over the most recent requests, slowest first. Held in memory only. */
export function latencySnapshot() {
  return [...latency.entries()].map(([route, samples]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return { route, count: samples.length, p50: Math.round(percentile(sorted, 50)), p95: Math.round(percentile(sorted, 95)), p99: Math.round(percentile(sorted, 99)), max: Math.round(sorted[sorted.length - 1] ?? 0) };
  }).sort((a, b) => b.p95 - a.p95);
}

/** The route pattern, never the real URL: ids, tokens and query strings stay out of logs and metrics. */
const routeOf = (req: Request) => `${req.method} ${req.baseUrl}${typeof req.route?.path === 'string' ? req.route.path : ''}` || `${req.method} (unmatched)`;

/**
 * Gives every request an id (returned in `X-Request-Id` and in error bodies so support can find it), measures it,
 * reports database time and query count in `Server-Timing`, keeps rolling latency percentiles, and writes one
 * structured log line per request. No headers, bodies, query strings, phone numbers or tokens are ever logged.
 */
export function observe(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const start = performance.now();
  const stats: RequestStats = { queries: 0, dbMs: 0 };

  const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => Response;
  (res as unknown as { writeHead: (...a: unknown[]) => Response }).writeHead = (...args: unknown[]) => {
    if (!res.headersSent) res.setHeader('Server-Timing', `db;dur=${stats.dbMs.toFixed(0)};desc="${stats.queries} queries", app;dur=${(performance.now() - start).toFixed(0)}`);
    return writeHead(...args);
  };

  res.on('finish', () => {
    const ms = performance.now() - start;
    const route = routeOf(req);
    if (res.statusCode !== 404) {
      const samples = latency.get(route) ?? [];
      samples.push(ms);
      if (samples.length > SAMPLES) samples.shift();
      latency.set(route, samples);
    }
    if (!config.logRequests && ms < SLOW_MS) return;
    const line = { level: ms >= SLOW_MS || res.statusCode >= 500 ? 'warn' : 'info', msg: 'request', id, route, status: res.statusCode, ms: Math.round(ms), dbMs: Math.round(stats.dbMs), queries: stats.queries };
    console.log(JSON.stringify(line));
    if (ms >= 5000) reportError(new Error(`Very slow request: ${route} took ${Math.round(ms)} ms (${stats.queries} queries, ${Math.round(stats.dbMs)} ms in the database)`));
  });

  requestStats.run(stats, next);
}
