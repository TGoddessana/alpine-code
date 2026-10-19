import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { CompactionLine } from './CompactionLine';

afterEach(cleanup);

const item = { id: 'c', kind: 'compaction', beforeTokens: 96_000, afterTokens: 12_000 } as const;

function show(extra: { summary: string | null; cleared: number }) {
  render(
    <LocaleProvider locale="ko">
      <CompactionLine item={{ ...item, ...extra }} />
    </LocaleProvider>,
  );
}

describe('CompactionLine', () => {
  it('opens to the cleared results and the summary', () => {
    show({ summary: '남은 일: 테스트 하나', cleared: 14 });
    const line = screen.getByRole('button', { name: /대화를 정리했어요 · 96,000 → 12,000 토큰/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('오래된 읽기 결과 14개를 비웠어요. 필요하면 다시 읽어요.')).toBeTruthy();
    expect(screen.getByText('남은 일: 테스트 하나')).toBeTruthy();
  });

  it('shows only what happened: clearing without a summary', () => {
    show({ summary: null, cleared: 3 });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/읽기 결과 3개/)).toBeTruthy();
    expect(screen.queryByText('앞부분 요약')).toBeNull();
  });

  it('is a plain line when there is nothing to open', () => {
    show({ summary: null, cleared: 0 });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/대화를 정리했어요/)).toBeTruthy();
  });
});
