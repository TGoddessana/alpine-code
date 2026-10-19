import type { ProjectInfo } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import {
  chatScript,
  mergeScripts,
  PROJECTS,
  scriptedConnection,
  ServerError,
  ServerProvider,
  type NewProjectScript,
  type Script,
  type ServerConnection,
} from '@/shared/server';

import { NewSession } from './NewSession';

// The chips in the input send me to Settings; no router runs here.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const project = PROJECTS[0]!;
const other = PROJECTS[1]!;
const IDEA = '동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘';
const fast: NewProjectScript = { judgeMs: 0, createMs: 0 };

function mount(newProject: NewProjectScript = fast, overrides: Script = {}) {
  const base = scriptedConnection(mergeScripts(chatScript({ newProject }), overrides));
  const requests: { method: string; params: unknown }[] = [];
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params });
      return base.request(method, params);
    },
    subscribe: base.subscribe,
  };
  const onStarted = vi.fn();
  const onProjectChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (shown: ProjectInfo) => (
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <NewSession project={shown} onProjectChange={onProjectChange} onStarted={onStarted} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>
  );
  const view = render(tree(project));
  const sent = (method: string) => requests.filter((r) => r.method === method).map((r) => r.params);
  // The rail picks another project: the same screen gets another `project`.
  const switchTo = (next: ProjectInfo) => view.rerender(tree(next));
  return { onStarted, onProjectChange, sent, switchTo };
}

async function send(text: string) {
  fireEvent.input(await screen.findByLabelText('메시지'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '보내기' }));
}

const create = async () => fireEvent.click(await screen.findByRole('button', { name: '만들기' }));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NewSession', () => {
  it('asks the server to judge what was sent, with the language and the project, and shows its pick and why', async () => {
    const { sent } = mount();
    await send(`  ${IDEA}  `);
    expect(await screen.findByText('로그인과 예약 저장이면 Lite로 충분해요.')).toBeTruthy();
    expect(sent('projects/judge')).toEqual([{ text: IDEA, locale: 'ko', cwd: project.path }]);
    expect(screen.getByRole('radio', { name: /웹앱 Lite/ })).toHaveProperty('ariaChecked', 'true');
    expect(sent('session/new')).toEqual([]);
  });

  it('makes the project with the judged name and the picked setup, shows the steps and the real folder, then opens the session', async () => {
    const { sent, onStarted } = mount();
    await send(IDEA);
    await create();
    expect(await screen.findByText('/Users/me/AlpineCode/craft-booking')).toBeTruthy();
    const open = await screen.findByRole('button', { name: '세션으로 가기' });

    expect(sent('projects/create')).toEqual([
      { id: expect.any(String), idea: IDEA, template: 'web-lite', name: 'craft-booking', agent: 'a-site' },
    ]);
    expect(onStarted).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect(onStarted).toHaveBeenCalledWith(expect.stringMatching(/^s-/));
    // The server started the session on the idea itself; the screen starts none.
    expect(sent('session/new')).toEqual([]);
    expect(sent('session/send')).toEqual([]);
  });

  it('makes it with another setup when I pick one, and only the steps the server announces tick', async () => {
    const { sent } = mount({ ...fast, templates: ['blank', 'web-lite'] });
    await send(IDEA);
    fireEvent.click(await screen.findByRole('radio', { name: /빈 프로젝트/ }));
    await create();
    await screen.findByRole('button', { name: '세션으로 가기' });
    expect(sent('projects/create')).toEqual([expect.objectContaining({ template: 'blank', name: 'craft-booking' })]);
    // Not signed in to Alpine: no web address step.
    expect(screen.queryByText('인터넷 주소 만들기')).toBeNull();
    expect(screen.getAllByText('완료')).toHaveLength(2);
  });

  it('starts a session on this project when the server says it is work on it', async () => {
    const { sent, onStarted } = mount();
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
    expect(sent('session/new')).toEqual([expect.objectContaining({ cwd: project.path })]);
    expect(sent('session/send')).toEqual([expect.objectContaining({ text: '첫 화면 버튼을 더 크게 바꿔 줘' })]);
    expect(sent('projects/create')).toEqual([]);
  });

  it('treats a judging that failed as work on this project, so the message still starts a session', async () => {
    const { sent, onStarted } = mount({ ...fast, judgeFails: true });
    await send(IDEA);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
    expect(sent('session/send')).toEqual([expect.objectContaining({ text: IDEA })]);
    expect(sent('projects/create')).toEqual([]);
  });

  it('works on this project when I say it is not a new app', async () => {
    const { sent, onStarted } = mount();
    await send(IDEA);
    fireEvent.click(await screen.findByRole('button', { name: '아니요, 이 프로젝트에서 할게요' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
    expect(sent('session/send')).toEqual([expect.objectContaining({ text: IDEA })]);
    expect(sent('projects/create')).toEqual([]);
  });

  it('ignores the answer to an earlier message when another was sent meanwhile', async () => {
    const answers: ((judgement: unknown) => void)[] = [];
    const slow: Script = {
      results: {
        'projects/judge': () =>
          new Promise<never>((resolve) => {
            answers.push(resolve as (judgement: unknown) => void);
          }),
      },
    };
    const { sent, onStarted } = mount(fast, slow);
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(answers).toHaveLength(1));
    await send(IDEA);
    await waitFor(() => expect(answers).toHaveLength(2));

    // The first answer (work on the project) comes last of the two... and the second one comes first.
    answers[1]!({
      judgement: {
        kind: 'new',
        template: 'web-lite',
        reason: '로그인과 예약 저장이면 Lite로 충분해요.',
        name: 'craft-booking',
      },
    });
    expect(await screen.findByText('로그인과 예약 저장이면 Lite로 충분해요.')).toBeTruthy();
    answers[0]!({ judgement: { kind: 'change' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onStarted).not.toHaveBeenCalled();
    expect(sent('session/new')).toEqual([]);
    expect(screen.getByRole('button', { name: '만들기' })).toBeTruthy();
  });

  it('says plainly when nothing could be made, and the way back shows the setups again', async () => {
    const { sent } = mount({ ...fast, createFails: 'folder' });
    await send(IDEA);
    await create();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('프로젝트를 만들지 못했어요');
    expect(alert.textContent).toContain('Permission denied');
    expect(screen.getByRole('heading', { name: '만들지 못했어요' })).toBeTruthy();
    expect(screen.queryByText('진행 중')).toBeNull();
    expect(screen.queryByRole('button', { name: '세션으로 가기' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /웹앱 Lite/ })).toHaveProperty('ariaChecked', 'true');
    expect(sent('projects/create')).toHaveLength(1);
  });

  it('names a template the server does not have, and one it cannot read the settings for', async () => {
    const failing = (reason: 'not_found' | 'invalid_config'): Script => ({
      results: {
        'projects/create': () => {
          throw new ServerError(-32000, 'x', { reason });
        },
      },
    });
    mount(fast, failing('not_found'));
    await send(IDEA);
    await create();
    expect((await screen.findByRole('alert')).textContent).toContain('이 구성을 찾지 못했어요');
    cleanup();

    mount(fast, failing('invalid_config'));
    await send(IDEA);
    await create();
    expect((await screen.findByRole('alert')).textContent).toContain('설정을 읽지 못했어요');
  });

  it('goes on to the project that was made when only the AI could not start, with the idea back in the input', async () => {
    const { onProjectChange, onStarted } = mount({ ...fast, createFails: 'session' });
    await send(IDEA);
    await create();
    expect(await screen.findByRole('heading', { name: '프로젝트는 만들었어요' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('AI를 시작하지 못했어요');

    fireEvent.click(screen.getByRole('button', { name: '프로젝트 열기' }));
    expect(onProjectChange).toHaveBeenCalledWith('/Users/me/AlpineCode/craft-booking');
    expect(onStarted).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByLabelText('메시지') as HTMLTextAreaElement).value).toBe(IDEA));
  });

  it('puts the message back and says so when the session for work on this project cannot start', async () => {
    const { onStarted } = mount(fast, {
      results: {
        'session/new': () => {
          throw new ServerError(-32000, 'No such folder');
        },
      },
    });
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    expect((await screen.findByRole('alert')).textContent).toContain('세션을 시작하지 못했어요');
    await waitFor(() =>
      expect((screen.getByLabelText('메시지') as HTMLTextAreaElement).value).toBe('첫 화면 버튼을 더 크게 바꿔 줘'),
    );
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('drops a judging that was sent on another project, so it starts nothing where I am now', async () => {
    const answers: ((judgement: unknown) => void)[] = [];
    const slow: Script = {
      results: {
        'projects/judge': () =>
          new Promise<never>((resolve) => {
            answers.push(resolve as (judgement: unknown) => void);
          }),
      },
    };
    const { sent, onStarted, switchTo } = mount(fast, slow);
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(screen.getByText('에이전트가 판단하고 있어요')).toBeTruthy();

    switchTo(other);
    expect(screen.queryByText('에이전트가 판단하고 있어요')).toBeNull();
    expect(screen.getByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();
    answers[0]!({ judgement: { kind: 'change' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onStarted).not.toHaveBeenCalled();
    expect(sent('session/new')).toEqual([]);
    expect(screen.getByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();
  });

  it('drops the setups shown for a message sent on another project, and judges the next one where I am', async () => {
    const { sent, switchTo } = mount();
    await send(IDEA);
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();

    switchTo(other);
    expect(screen.queryByRole('radiogroup', { name: '구성' })).toBeNull();
    expect(screen.queryByRole('button', { name: '아니요, 이 프로젝트에서 할게요' })).toBeNull();
    expect(screen.getByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();

    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(sent('session/new')).toEqual([expect.objectContaining({ cwd: other.path })]));
    expect(sent('projects/judge')).toEqual([
      expect.objectContaining({ cwd: project.path }),
      expect.objectContaining({ cwd: other.path }),
    ]);
  });

  it('goes on making a project when I look at another one meanwhile', async () => {
    const { sent, switchTo } = mount({ judgeMs: 0, createMs: 60 });
    await send(IDEA);
    await create();
    expect(await screen.findByText('/Users/me/AlpineCode/craft-booking')).toBeTruthy();

    switchTo(other);
    expect(await screen.findByRole('button', { name: '세션으로 가기' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '프로젝트를 만들었어요' })).toBeTruthy();
    expect(sent('projects/create')).toHaveLength(1);
  });

  it('does nothing with the answer once I have left the screen', async () => {
    const { sent, onStarted } = mount({ judgeMs: 50 });
    const view = await send('첫 화면 버튼을 더 크게 바꿔 줘');
    void view;
    await waitFor(() => expect(sent('projects/judge')).toHaveLength(1));
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onStarted).not.toHaveBeenCalled();
    expect(sent('session/new')).toEqual([]);
  });
});
