import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';

/** Loads data every time the screen gains focus; keeps showing old data while refreshing. */
export function useLoad<T>(fn: () => Promise<T>) {
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
  return { data, error, loading, reload, setData };
}
