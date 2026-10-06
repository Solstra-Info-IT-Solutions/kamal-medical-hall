import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { onRealtime } from '../../../realtime';
import { notificationUseCases } from '../module';
import { createNotificationsViewModel, type NotificationsViewModel } from './NotificationsViewModel';

/** Binds the framework-free view model to React: one per mounted screen, refreshed on focus and on live pushes. */
export function useNotificationsViewModel() {
  const ref = useRef<NotificationsViewModel | null>(null);
  ref.current ??= createNotificationsViewModel(notificationUseCases);
  const vm = ref.current;
  const state = useSyncExternalStore(vm.subscribe, vm.getState, vm.getState);
  useFocusEffect(useCallback(() => { void vm.load(); }, [vm]));
  useEffect(() => onRealtime('notification', () => { void vm.load(); }), [vm]); // returns its own unsubscribe
  return { vm, state };
}
