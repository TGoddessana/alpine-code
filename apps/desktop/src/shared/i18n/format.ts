import { useMemo } from 'react';

import { useLocale } from './locale';

/** A length of time as its two largest units: '12초', '1분 5초', '1시간 2분' (en '12s', '1m 5s', '1h 2m'). */
export function formatDuration(ms: number, locale: string): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const ko = locale.startsWith('ko');
  const unit = { h: ko ? '시간' : 'h', m: ko ? '분' : 'm', s: ko ? '초' : 's' };
  const parts: [number, string][] =
    hours > 0
      ? [
          [hours, unit.h],
          [minutes, unit.m],
        ]
      : minutes > 0
        ? [
            [minutes, unit.m],
            [rest, unit.s],
          ]
        : [[rest, unit.s]];
  return parts
    .filter(([n], i) => i === 0 || n > 0)
    .map(([n, u]) => `${n}${u}`)
    .join(' ');
}

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
      duration: (ms: number) => formatDuration(ms, locale),
      money: (value: number, currency = 'USD') =>
        new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value),
    };
  }, [locale]);
}
