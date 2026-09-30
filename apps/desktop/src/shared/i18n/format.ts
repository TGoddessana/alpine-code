import { useMemo } from 'react';

import { useLocale } from './locale';

/** Times, numbers and money in the current language, via the built-in Intl. */
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const number = new Intl.NumberFormat(locale);
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    return {
      time: (date: Date) => time.format(date),
      /** How long ago, in the largest unit that fits: '지금', '2시간 전', '어제', '지난주'. */
      since: (date: Date, now = new Date()) => {
        const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
        if (minutes > -1) return relative.format(0, 'second');
        if (minutes > -60) return relative.format(minutes, 'minute');
        const hours = Math.round(minutes / 60);
        if (hours > -24) return relative.format(hours, 'hour');
        const days = Math.round(hours / 24);
        if (days > -7) return relative.format(days, 'day');
        const weeks = Math.round(days / 7);
        if (weeks > -5) return relative.format(weeks, 'week');
        return relative.format(Math.round(days / 30), 'month');
      },
      number: (value: number) => number.format(value),
      money: (value: number, currency = 'USD') =>
        new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value),
    };
  }, [locale]);
}
