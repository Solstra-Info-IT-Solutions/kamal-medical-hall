import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';

/**
 * The Firebase *web app* ("Kamal Medical Hall Web") used by the website for push notifications (and for Firebase
 * phone sign-in when the server is not sending OTPs itself). These values are public by design: they identify the
 * project, they do not grant access. EXPO_PUBLIC_FIREBASE_WEB_CONFIG can override them.
 */
const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyCqSkB3Ip3ubgB3Cw4cFJdBzw12B6DIxOA',
  authDomain: 'kamal-medical-hall.firebaseapp.com',
  projectId: 'kamal-medical-hall',
  storageBucket: 'kamal-medical-hall.firebasestorage.app',
  messagingSenderId: '623487847396',
  appId: '1:623487847396:web:4ce00811447c2d482ad5f1',
};

function readConfig(): Record<string, string> {
  const raw = process.env.EXPO_PUBLIC_FIREBASE_WEB_CONFIG;
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.messagingSenderId && parsed.appId?.includes(':web:') ? parsed : { ...parsed, ...DEFAULT_CONFIG };
  } catch { return DEFAULT_CONFIG; }
}

export const firebaseWebConfig = readConfig();
export const firebaseWebApp = (): FirebaseApp => getApps()[0] ?? initializeApp(firebaseWebConfig);
