import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { WorkResult } from './WorkResult';

afterEach(cleanup);

it('shows failed commands as failed rather than completed', () => {
  render(
    <LocaleProvider locale="ko">
      <WorkResult result={{ files: [], commands: [{ id: 'c1', command: 'exit 3', status: 'error' }] }} />
    </LocaleProvider>,
  );
  expect(screen.getByText('실패')).toBeTruthy();
  expect(screen.queryByText('끝남')).toBeNull();
});

it('opens and closes the actual baseline-to-final change', () => {
  render(
    <LocaleProvider locale="ko">
      <WorkResult
        result={{
          files: [{ path: 'file.txt', added: 1, removed: 1, diff: ['@@ -1 +1 @@', '-original', '+final'] }],
          commands: [],
        }}
      />
    </LocaleProvider>,
  );
  const file = screen.getByRole('button', { name: /file\.txt/ });
  fireEvent.click(file);
  expect(screen.getByRole('region', { name: 'file.txt 바뀐 내용' }).textContent).toContain('+final');
  fireEvent.click(file);
  expect(screen.queryByRole('region', { name: 'file.txt 바뀐 내용' })).toBeNull();
});

it('keeps files without a recorded diff in changes and supports reviewing all files', () => {
  render(
    <LocaleProvider locale="ko">
      <WorkResult
        result={{
          files: [
            { path: 'old.txt', added: 0, removed: 0, diff: null },
            { path: 'new.txt', added: 1, removed: 0, diff: ['@@ -0,0 +1 @@', '+new'] },
          ],
          commands: [],
        }}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'old.txt' }));
  expect(screen.getByRole('region', { name: 'old.txt 바뀐 내용' }).textContent).toContain(
    '기록된 텍스트 diff가 없어요',
  );
  expect(screen.getByText('이 세션에서 기록한 변경 · 마지막 실행 기준')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '모두 보기' }));
  expect(screen.getByRole('region', { name: 'new.txt 바뀐 내용' }).textContent).toContain('+new');
  fireEvent.click(screen.getByRole('button', { name: '모두 접기' }));
  expect(screen.queryByRole('region', { name: 'new.txt 바뀐 내용' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'old.txt 바뀐 내용' })).toBeNull();
});
