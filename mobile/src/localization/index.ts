import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en/common.json';
import hi from './hi/common.json';

const LANGUAGE_KEY = 'kmh.language';

const initialization = i18n.use(initReactI18next).init({
  resources: { en: { common: en }, hi: { common: hi } },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

/** English is the default; the customer's saved choice wins. */
export async function restoreLanguage(): Promise<void> {
  await initialization;
  const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
  await i18n.changeLanguage(saved === 'hi' ? 'hi' : 'en');
}

export async function setLanguage(language: 'en' | 'hi'): Promise<void> {
  await i18n.changeLanguage(language);
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}

export default i18n;
