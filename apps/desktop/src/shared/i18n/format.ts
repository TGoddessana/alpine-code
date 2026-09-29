import { useMemo } from 'react';

import { useLocale } from './locale';

/** Times, numbers and money in the current language, via the built-in Intl. */
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const number = new Intl.NumberFormat(locale);
    return {
      time: (date: Date) => time.format(date),
      number: (value: number) => number.format(value),
      money: (value: number, currency = 'USD') =>
        new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value),
    };
  }, [locale]);
}
