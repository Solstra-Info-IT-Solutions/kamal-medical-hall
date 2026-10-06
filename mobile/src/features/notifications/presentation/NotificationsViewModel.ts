import { destinationOf, unreadCount, type Destination, type Notification } from '../domain/Notification';
import type { NotificationUseCases } from '../domain/useCases';

export interface NotificationsState {
  status: 'loading' | 'ready' | 'error';
  items: Notification[];
  unread: number;
  /** Why the list could not be loaded (shown as a full-screen retry state). */
  loadError: string | null;
  /** The last failed action (shown as a popup); cleared by `dismissError`. */
  actionError: string | null;
}

/**
 * Presentation logic for the notifications screen, with no React and no UI inside: it holds the state, reacts to
 * user intents (open, remove, mark all, clear all, refresh) and talks only to use cases. The screen renders
 * `getState()` and calls these methods; the hook in `useNotificationsViewModel` just subscribes.
 */
export function createNotificationsViewModel(useCases: NotificationUseCases) {
  let state: NotificationsState = { status: 'loading', items: [], unread: 0, loadError: null, actionError: null };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  const set = (patch: Partial<NotificationsState> & { items?: Notification[] }) => {
    const items = patch.items ?? state.items;
    state = { ...state, ...patch, items, unread: unreadCount(items) };
    listeners.forEach((l) => l());
  };
  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

  /** Optimistic change: show the result now, undo it (and say why) if the server refuses. */
  const optimistic = async (apply: Notification[], action: () => Promise<void>) => {
    const before = state.items;
    set({ items: apply });
    try { await action(); } catch (e) { set({ items: before, actionError: message(e) }); }
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Loads (or reloads). Concurrent calls share one request. Existing items stay visible while refreshing. */
    load(): Promise<void> {
      loading ??= (async () => {
        try { set({ items: await useCases.list(), status: 'ready', loadError: null }); }
        catch (e) { set(state.items.length ? { actionError: message(e) } : { status: 'error', loadError: message(e) }); }
        finally { loading = null; }
      })();
      return loading;
    },

    /** The user tapped a notification: mark just that one as read and say where it leads. */
    async open(id: string): Promise<Destination> {
      const n = state.items.find((x) => x.id === id);
      if (!n) return null;
      if (!n.read) void optimistic(state.items.map((x) => (x.id === id ? { ...x, read: true } : x)), () => useCases.markRead(n));
      return destinationOf(n);
    },
    remove: (id: string) => optimistic(state.items.filter((x) => x.id !== id), () => useCases.remove(id)),
    // The use case must see the list as it was *before* the optimistic change, or it would think there is nothing to do.
    markAllRead() { const before = state.items; return optimistic(before.map((x) => ({ ...x, read: true })), () => useCases.markAllRead(before)); },
    clearAll() { const before = state.items; return optimistic([], () => useCases.clearAll(before)); },
    dismissError: () => set({ actionError: null }),
  };
}
export type NotificationsViewModel = ReturnType<typeof createNotificationsViewModel>;
