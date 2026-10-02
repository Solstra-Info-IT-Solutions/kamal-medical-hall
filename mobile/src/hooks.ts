import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onRealtime } from './realtime';

/**
 * Loads data every time the screen gains focus and, when `events` are given, again whenever the server pushes
 * one of those real-time events. Keeps showing old data while refreshing.
 */
export function useLoad<T>(fn: () => Promise<T>, events: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setError(null);
    try { setData(await fnRef.current()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const key = events.join('|');
  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { void reload(); }, 250); }; // coalesce bursts
    const offs = [...key.split('|'), 'connect'].map((e) => onRealtime(e, refresh));
    return () => { clearTimeout(timer); offs.forEach((off) => off()); };
  }, [key, reload]);
  return { data, error, loading, reload, setData };
}

/** Focuses an input shortly after the screen finishes its transition (autoFocus fires too early during animations). */
export function useAutoFocus(ref: { current: { focus(): void } | null }, delay = 450) {
  useEffect(() => {
    const id = setTimeout(() => ref.current?.focus(), delay);
    return () => clearTimeout(id);
  }, [ref, delay]);
}
