import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useFormat } from './format';
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
