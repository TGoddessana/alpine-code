import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { ProjectChoices } from './ProjectChoices';

const show = (locale: 'ko' | 'en', handlers = { onNew: vi.fn(), onGet: vi.fn(), onOpen: vi.fn() }) => {
  render(
    <LocaleProvider locale={locale}>
      <ProjectChoices {...handlers} />
    </LocaleProvider>,
  );
  return handlers;
};

describe('ProjectChoices', () => {
  afterEach(cleanup);

  it('lists 새로 만들기 first, then getting a project, then opening a folder', () => {
    show('ko');
    expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual([
      '새로 만들기아이디어를 적으면 구성을 골라 줘요',
      '회사·팀 프로젝트 받기GitHub, GitLab 같은 저장소 주소로',
      '내 컴퓨터의 프로젝트 열기이미 이 컴퓨터에 있는 폴더⌘O',
    ]);
  });

  it('says the same in English', () => {
    show('en');
    expect(screen.getAllByRole('button')[0]!.textContent).toBe(
      'Make a new projectWrite your idea and get a setup picked',
    );
  });

  it('calls the handler of the row that was clicked', () => {
    const { onNew, onGet, onOpen } = show('ko');
    fireEvent.click(screen.getByRole('button', { name: /^새로 만들기/ }));
    expect([onNew, onGet, onOpen].map((fn) => fn.mock.calls.length)).toEqual([1, 0, 0]);
    fireEvent.click(screen.getByRole('button', { name: /^회사·팀 프로젝트 받기/ }));
    fireEvent.click(screen.getByRole('button', { name: /^내 컴퓨터의 프로젝트 열기/ }));
    expect([onNew, onGet, onOpen].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
