import { Alert, Platform } from 'react-native';

/** Cross-platform confirm (Alert does not render on web). */
export function confirmAsync(title: string, message: string, okLabel: string, cancelLabel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export function notice(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
