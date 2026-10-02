import { create } from 'zustand';
import type { IconName } from './components/ui';

export interface DialogOptions {
  title: string;
  message?: string;
  icon?: IconName;
  tone?: 'primary' | 'danger';
  confirmLabel: string;
  /** Omit for a single-button information dialog. */
  cancelLabel?: string;
  /** When set, the confirm button stays disabled until the user ticks this acknowledgement. */
  acknowledge?: string;
}

interface DialogState {
  current: (DialogOptions & { resolve: (ok: boolean) => void }) | null;
  queue: Array<DialogOptions & { resolve: (ok: boolean) => void }>;
  close: (ok: boolean) => void;
}

/** Backing store for the themed dialog rendered by <DialogHost/>. */
export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  queue: [],
  close: (ok) => {
    get().current?.resolve(ok);
    const [next, ...rest] = get().queue;
    set({ current: next ?? null, queue: rest });
  },
}));

/** Shows the app-themed dialog; resolves true when confirmed. Replaces the native/browser alert. */
export function showDialog(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const item = { ...options, resolve };
    const { current, queue } = useDialog.getState();
    if (current) useDialog.setState({ queue: [...queue, item] });
    else useDialog.setState({ current: item });
  });
}

export function confirmAsync(title: string, message: string, okLabel: string, cancelLabel: string, destructive = false): Promise<boolean> {
  return showDialog({ title, message, confirmLabel: okLabel, cancelLabel, tone: destructive ? 'danger' : 'primary', icon: destructive ? 'warning' : 'help-circle' });
}

export async function notice(title: string, message?: string, okLabel = 'OK') {
  await showDialog({ title, message, confirmLabel: okLabel, icon: 'information-circle' });
}
