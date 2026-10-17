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
