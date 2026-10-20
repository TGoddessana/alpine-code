import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { firstRunScript, scriptedConnection, ServerProvider } from '@/shared/server';

import { NoProject } from './NoProject';

describe('NoProject', () => {
  afterEach(cleanup);

  const show = (cloud: boolean, onNewProject = vi.fn()) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServerProvider connection={scriptedConnection(firstRunScript('connected', { enabled: cloud }))}>
          <LocaleProvider locale="ko">
            <NoProject onNewProject={onNewProject} />
          </LocaleProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );
    return screen.getByRole('region', { name: '어떤 프로젝트로 시작할까요?' });
  };

  it('offers 새로 만들기 first among three ways in, and it goes to the new project', async () => {
    const onNewProject = vi.fn();
    const section = show(true, onNewProject);
    await within(section).findByRole('button', { name: /^새로 만들기/ });
    const rows = within(section).getAllByRole('button');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('새로 만들기');
    fireEvent.click(rows[0]!);
    expect(onNewProject).toHaveBeenCalledOnce();
  });

  it('offers only 받기 and 열기 without Alpine Cloud, as before', async () => {
    const section = show(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rows = within(section).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      '회사·팀 프로젝트 받기GitHub, GitLab 같은 저장소 주소로',
      '내 컴퓨터의 프로젝트 열기이미 이 컴퓨터에 있는 폴더⌘O',
    ]);
  });
});
