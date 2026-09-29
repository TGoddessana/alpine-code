import { createContext, useContext, useState, type ReactNode } from 'react';

import { LOCALES, type Locale, type Messages } from './define';

const STORAGE_KEY = 'alpine.locale';

/** The saved choice, else the OS language, else Korean. */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // Storage can be unavailable; fall back to the OS language.
  }
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ locale: fixed, children }: { locale?: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => fixed ?? initialLocale());
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not saved; the choice still applies until the app closes.
    }
  };
  const current = fixed ?? locale;
  return <LocaleContext value={{ locale: current, setLocale }}>{children}</LocaleContext>;
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (!state) throw new Error('useLocale needs a LocaleProvider');
  return state;
}

/** The current language's copy from a feature's `messages.ts`. */
export function useMessages<T>(messages: Messages<T>): T {
  return messages[useLocale().locale];
}
