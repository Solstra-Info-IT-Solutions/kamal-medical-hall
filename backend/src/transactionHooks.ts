
import type { ClientSession } from 'mongoose';

type AfterCommitCallback = () => void | Promise<void>;

const callbacks = new WeakMap<ClientSession, AfterCommitCallback[]>();

/**
 * Clears callbacks from a previous transaction attempt.
 * MongoDB may retry a transaction callback.
 */
export function resetAfterCommit(session: ClientSession): void {
  callbacks.set(session, []);
}

/**
 * Registers work that must run only after a successful commit.
 */
export function afterCommit(
  session: ClientSession,
  callback: AfterCommitCallback,
): void {
  const queue = callbacks.get(session);

  if (!queue) {
    throw new Error(
      'No active transaction callback queue. Register callbacks inside tx().',
    );
  }

  queue.push(callback);
}

/**
 * Executes queued callbacks after the transaction has committed.
 * Callback failures must not make a committed transaction appear to fail.
 */
export async function runAfterCommit(
  session: ClientSession,
): Promise<void> {
  const queue = callbacks.get(session) ?? [];

  callbacks.delete(session);

  for (const callback of queue) {
    try {
      await callback();
    } catch (error) {
      console.error('Post-commit callback failed:', error);
    }
  }
}

/**
 * Discards callbacks when the transaction fails.
 */
export function discardAfterCommit(session: ClientSession): void {
  callbacks.delete(session);
}
