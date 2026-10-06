/**
 * Carries API requests over the live socket instead of HTTP. It is shaped like `fetch` (takes a URL and init, returns a
 * `Response`), so the HTTP client above it keeps all its behaviour (timeouts, retries, token refresh, error messages)
 * and does not know which transport is in use. No React Native imports: it is unit-tested with a fake socket.
 *
 * Wire format, one `rpc` message per request:   { m: method, p: path, b: body, a: "Bearer <token>", id: request id }
 * and the acknowledgement:                      { s: status, b: body, h: { retry-after, x-request-id, server-timing } }
 */
export interface SocketLike {
  connected: boolean;
  emit(event: 'rpc', message: unknown, ack: (reply: unknown) => void): unknown;
  on(event: 'connect' | 'disconnect', fn: () => void): unknown;
  off(event: 'connect' | 'disconnect', fn: () => void): unknown;
}

export interface SocketFetchDeps {
  baseUrl: string;
  /** Called for every request, so a replaced connection (after sign-in or sign-out) is picked up. */
  getSocket: () => SocketLike;
  /** How long to wait for a connection that is not up yet, before giving up with a network error (default 12 s). */
  connectWaitMs?: number;
}

/** A transport failure, which the HTTP client turns into its normal "network" error (and retries when safe). */
export class SocketTransportError extends Error {}

interface Reply { s: number; b: unknown; h?: Record<string, string> }
const isReply = (v: unknown): v is Reply => typeof v === 'object' && v !== null && Number.isInteger((v as Reply).s) && (v as Reply).s >= 200 && (v as Reply).s <= 599;

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

export function createSocketFetch(deps: SocketFetchDeps): typeof fetch {
  const connectWaitMs = deps.connectWaitMs ?? 12_000;

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.startsWith(deps.baseUrl)) throw new SocketTransportError('unexpected url');
    const path = url.slice(deps.baseUrl.length) || '/';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError();

    const message = {
      m: (init?.method ?? 'GET').toUpperCase(),
      p: path,
      b: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      a: headers.Authorization,
      id: headers['X-Request-Id'],
    };

    const socket = deps.getSocket();
    const cleanups: Array<() => void> = [];
    try {
      const reply = await new Promise<unknown>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal?.addEventListener('abort', onAbort);
        cleanups.push(() => signal?.removeEventListener('abort', onAbort));

        // If the connection drops while we wait, fail now instead of waiting for the timeout.
        const onDown = () => reject(new SocketTransportError('connection lost'));
        socket.on('disconnect', onDown);
        cleanups.push(() => socket.off('disconnect', onDown));

        const send = () => socket.emit('rpc', message, resolve);
        if (socket.connected) return send();
        const wait = setTimeout(() => reject(new SocketTransportError('not connected')), connectWaitMs);
        const onUp = () => { clearTimeout(wait); socket.off('connect', onUp); send(); };
        socket.on('connect', onUp);
        cleanups.push(() => { clearTimeout(wait); socket.off('connect', onUp); });
      });
      if (!isReply(reply)) throw new SocketTransportError('unexpected reply');
      const noBody = reply.s === 204 || reply.s === 304 || reply.b === null || reply.b === undefined;
      return new Response(noBody ? null : JSON.stringify(reply.b), { status: reply.s, headers: reply.h ?? {} });
    } finally {
      for (const fn of cleanups) fn();
    }
  }) as typeof fetch;
}
