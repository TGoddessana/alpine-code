import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { formatDuration, useFormat } from './format';
import { LocaleProvider } from './locale';

const now = new Date('2026-09-30T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

function since(locale: 'ko' | 'en', date: Date) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider locale={locale}>{children}</LocaleProvider>
  );
  return renderHook(() => useFormat(), { wrapper }).result.current.since(date, now);
}

describe('since', () => {
  it('uses the largest unit that fits', () => {
    expect(since('ko', ago(10_000))).toBe('지금');
    expect(since('ko', ago(2 * 3_600_000))).toBe('2시간 전');
    expect(since('ko', ago(24 * 3_600_000))).toBe('어제');
    expect(since('en', ago(3 * 86_400_000))).toBe('3 days ago');
  });
});

describe('formatDuration', () => {
  it('writes seconds, then minutes with seconds, then hours with minutes', () => {
    expect(formatDuration(0, 'ko')).toBe('0초');
    expect(formatDuration(12_900, 'ko')).toBe('12초');
    expect(formatDuration(65_000, 'ko')).toBe('1분 5초');
    expect(formatDuration(60_000, 'ko')).toBe('1분');
    expect(formatDuration(3_720_000, 'ko')).toBe('1시간 2분');
    expect(formatDuration(65_000, 'en')).toBe('1m 5s');
    expect(formatDuration(12_000, 'en')).toBe('12s');
    expect(formatDuration(-5, 'en')).toBe('0s');
  });
});
