import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/**
 * Moves to a screen without duplicating it on the stack: if it is already in the history we pop back to it
 * (React Navigation 7 `navigate` would push a second copy), otherwise we push it.
 * This keeps address → time → review → "change" loops from piling up screens.
 */
export function goTo(nav: NavigationProp<ParamListBase>, name: string, params?: object) {
  const exists = nav.getState().routes.some((r) => r.name === name);
  const n = nav as unknown as { popTo: (name: string, params?: object) => void; navigate: (name: string, params?: object) => void };
  if (exists) n.popTo(name, params);
  else n.navigate(name, params);
}
