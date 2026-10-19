import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { ContextMeter } from './ContextMeter';

afterEach(cleanup);

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, cost: null };

function show(contextTidyAt: number | null) {
  render(
    <LocaleProvider locale="ko">
      <ContextMeter info={{ contextUsed: 76_000, contextTidyAt, usage, runUsage: null }} />
    </LocaleProvider>,
  );
  return screen.getByRole('button');
}

describe('ContextMeter', () => {
  it('fills toward the point where the conversation is tidied', () => {
    const pie = show(95_000);
    expect(pie.getAttribute('aria-label')).toBe('대화 길이 80%, 사용량 보기');
    expect(pie.className).toContain('text-attention');
  });

  it('shows the length in tokens and a dotted circle when the window is unknown', () => {
    const pie = show(null);
    expect(pie.getAttribute('aria-label')).toBe('대화 길이 76,000 토큰, 사용량 보기');
    expect(pie.querySelector('circle')?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(pie.querySelector('path')).toBeNull();
  });
});
