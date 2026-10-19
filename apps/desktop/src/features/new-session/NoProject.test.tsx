import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { firstRunScript, scriptedConnection, ServerProvider } from '@/shared/server';

import { NoProject } from './NoProject';

describe('NoProject', () => {
  afterEach(cleanup);

  it('offers 새로 만들기 first among three ways in, and it goes to the new project', () => {
    const onNewProject = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServerProvider connection={scriptedConnection(firstRunScript())}>
          <LocaleProvider locale="ko">
            <NoProject onNewProject={onNewProject} />
          </LocaleProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );
    const section = screen.getByRole('region', { name: '어떤 프로젝트로 시작할까요?' });
    const rows = within(section).getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('새로 만들기');
    fireEvent.click(rows[0]!);
    expect(onNewProject).toHaveBeenCalledOnce();
  });
});
