import type { ProjectInfo } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import {
  chatScript,
  cloudScript,
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

function mount(newProject: NewProjectScript = fast, overrides: Script = {}, start: ProjectInfo | null = project) {
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
  const onNewProject = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (shown: ProjectInfo | null) => (
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <NewSession
            project={shown}
            onProjectChange={onProjectChange}
            onNewProject={onNewProject}
            onStarted={onStarted}
          />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>
  );
  const view = render(tree(start));
  const sent = (method: string) => requests.filter((r) => r.method === method).map((r) => r.params);
  // The rail picks another project: the same screen gets another `project`.
  const switchTo = (next: ProjectInfo | null) => view.rerender(tree(next));
  return { onStarted, onProjectChange, onNewProject, sent, switchTo };
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
  it('starts with the question over a tall input in the middle of a snow scene, and no mascot', () => {
    mount();
    expect(screen.getByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();
    expect(screen.getByLabelText('메시지')).toHaveProperty('rows', 4);
    expect(document.querySelector('img[src="/brand/hare.png"]')).toBeNull();
    expect(document.querySelectorAll('main canvas')).toHaveLength(2);
  });

  it('asks the server to judge what was sent, with the language and the project, and shows its pick and why', async () => {
    const { sent } = mount();
    await send(`  ${IDEA}  `);
    expect(await screen.findByText('로그인과 예약 저장이면 웹앱으로 충분해요.')).toBeTruthy();
    expect(sent('projects/judge')).toEqual([{ text: IDEA, locale: 'ko', cwd: project.path }]);
    expect(screen.getByRole('radio', { name: /^웹앱/ })).toHaveProperty('ariaChecked', 'true');
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
        reason: '로그인과 예약 저장이면 웹앱으로 충분해요.',
        name: 'craft-booking',
      },
    });
    expect(await screen.findByText('로그인과 예약 저장이면 웹앱으로 충분해요.')).toBeTruthy();
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
    expect(screen.getByRole('radio', { name: /^웹앱/ })).toHaveProperty('ariaChecked', 'true');
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

describe('NewSession making a new project (새로 만들기)', () => {
  const asNew = (newProject: NewProjectScript = fast, overrides: Script = {}) => mount(newProject, overrides, null);

  it('asks what to make, and judges what was sent with newProject and no folder, showing the setups with its pick and why', async () => {
    const { sent } = asNew();
    expect(await screen.findByRole('heading', { name: '무엇을 만들어 볼까요?' })).toBeTruthy();
    expect(screen.getByPlaceholderText('만들고 싶은 앱을 적어 주세요')).toBeTruthy();
    await send(`  ${IDEA}  `);
    expect(await screen.findByText('로그인과 예약 저장이면 웹앱으로 충분해요.')).toBeTruthy();
    expect(sent('projects/judge')).toEqual([{ text: IDEA, locale: 'ko', newProject: true }]);
    expect(screen.getByRole('radio', { name: /^웹앱/ })).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByText('추천')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '이 구성으로 만들어 볼까요?' })).toBeTruthy();
    expect(sent('session/new')).toEqual([]);
  });

  it('is a new app even when what was written sounds like work on a project', async () => {
    const { sent } = asNew();
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();
    expect(sent('session/new')).toEqual([]);
  });

  it('has no way out to a project, no skills and no other apps conversations', async () => {
    const importable = {
      results: {
        'session/importable': {
          sessions: [
            { source: 'codex', id: 'x1', title: '결제 정리', updatedAt: new Date().toISOString(), imported: null },
          ],
        },
      },
    } satisfies Script;
    // On a project the same server shows both: the link under the heading, and the skills `/` lists.
    mount(fast, importable);
    expect(await screen.findByRole('button', { name: /Codex에서 하던 대화 1개 이어 하기/ })).toBeTruthy();
    fireEvent.input(screen.getByLabelText('메시지'), { target: { value: '/' } });
    expect(await screen.findByText('스킬 더 찾기')).toBeTruthy();
    cleanup();

    asNew(fast, importable);
    const box = await screen.findByLabelText('메시지');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /에서 하던 대화/ })).toBeNull();
    fireEvent.input(box, { target: { value: '/' } });
    expect(screen.queryByText('스킬 더 찾기')).toBeNull();
    fireEvent.input(box, { target: { value: '' } });
    await send(IDEA);
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '아니요, 이 프로젝트에서 할게요' })).toBeNull();
    expect(screen.getByRole('button', { name: '만들기' })).toBeTruthy();
  });

  it('shows the setups with the web app chosen, nobody recommending it and no reason, when the judging fails', async () => {
    const { sent, onStarted } = asNew({ ...fast, judgeFails: true });
    await send(IDEA);
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^웹앱/ })).toHaveProperty('ariaChecked', 'true');
    expect(screen.queryByText('추천')).toBeNull();
    expect(screen.queryByText('로그인과 예약 저장이면 웹앱으로 충분해요.')).toBeNull();
    expect(sent('projects/judge')).toHaveLength(1);
    expect(sent('session/new')).toEqual([]);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('does the same when the server answers work on a project anyway', async () => {
    const { sent } = asNew(fast, { results: { 'projects/judge': { judgement: { kind: 'change' } } } });
    await send(IDEA);
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^웹앱/ })).toHaveProperty('ariaChecked', 'true');
    expect(screen.queryByText('추천')).toBeNull();
    expect(sent('session/new')).toEqual([]);
  });

  it('leaves out the reason line when the pick has none, but still marks the pick', async () => {
    asNew(fast, {
      results: {
        'projects/judge': { judgement: { kind: 'new', template: 'blank', reason: '', name: 'tool' } },
      },
    });
    await send(IDEA);
    expect(await screen.findByRole('radio', { name: /빈 프로젝트/ })).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByText('추천')).toBeTruthy();
    expect(document.querySelector('p.text-interactive')).toBeNull();
  });

  it("makes the project with the agent shown, not a project's last one, and the setup picked", async () => {
    const { sent, onStarted } = asNew();
    await send(IDEA);
    await create();
    const open = await screen.findByRole('button', { name: '세션으로 가기' });
    expect(sent('projects/create')).toEqual([
      { id: expect.any(String), idea: IDEA, template: 'web-lite', name: 'craft-booking', agent: 'default' },
    ]);
    fireEvent.click(open);
    expect(onStarted).toHaveBeenCalledWith(expect.stringMatching(/^s-/));
  });

  it('lets the server name the folder when nobody picked a setup', async () => {
    const { sent } = asNew({ ...fast, judgeFails: true });
    await send(IDEA);
    await create();
    await screen.findByRole('button', { name: '세션으로 가기' });
    expect(sent('projects/create')).toEqual([expect.objectContaining({ template: 'web-lite', name: '' })]);
  });

  it('drops the setups shown when I pick a project in the chip, and works on that project', async () => {
    const { sent, switchTo } = asNew();
    await send(IDEA);
    expect(await screen.findByRole('radiogroup', { name: '구성' })).toBeTruthy();

    switchTo(other);
    expect(screen.queryByRole('radiogroup', { name: '구성' })).toBeNull();
    expect(screen.getByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(sent('session/new')).toEqual([expect.objectContaining({ cwd: other.path })]));
    expect(sent('projects/judge')[1]).toEqual({
      text: '첫 화면 버튼을 더 크게 바꿔 줘',
      locale: 'ko',
      cwd: other.path,
    });
  });
});

describe('NewSession folder chip', () => {
  const archived: ProjectInfo = { ...PROJECTS[2]!, name: 'old-site', path: '/Users/me/old-site', archived: true };
  const withArchived: Script = {
    results: { 'projects/list': { projects: [...PROJECTS, archived], clones: [] } },
  };

  it('names the project the session starts in, or 새 프로젝트 when making one', async () => {
    mount();
    expect(await screen.findByRole('button', { name: '프로젝트: alpine-code' })).toBeTruthy();
    cleanup();
    mount(fast, {}, null);
    expect(await screen.findByRole('button', { name: '프로젝트: 새 프로젝트' })).toBeTruthy();
  });

  it('lists the projects that are not archived with the current one checked, and picking one changes project', async () => {
    const { onProjectChange } = mount(fast, withArchived);
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트: alpine-code' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('alpine-code'),
      expect.stringContaining('docs-site'),
      expect.stringContaining('infra-terraform'),
    ]);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    expect(items[1]!.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitem', { name: '프로젝트 추가…' })).toBeTruthy();

    fireEvent.click(items[1]!);
    expect(onProjectChange).toHaveBeenCalledWith(other.path);
  });

  it('checks none of them while making a new project, and picking one leaves that mode', async () => {
    const { onProjectChange } = mount(fast, {}, null);
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트: 새 프로젝트' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.click(items[0]!);
    expect(onProjectChange).toHaveBeenCalledWith(project.path);
  });

  it('opens the project dialog from 프로젝트 추가…, where 새로 만들기 closes it and goes on to the new project', async () => {
    const { onNewProject } = mount();
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트: alpine-code' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '프로젝트 추가…' }));
    const dialog = await screen.findByRole('dialog', { name: '프로젝트 추가' });
    expect(within(dialog).getAllByRole('button').length).toBe(3);
    fireEvent.click(within(dialog).getByRole('button', { name: /^새로 만들기/ }));
    expect(onNewProject).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stays shut while the project is being made', async () => {
    mount({ judgeMs: 0, createMs: 60 });
    await send(IDEA);
    await create();
    await screen.findByText('/Users/me/AlpineCode/craft-booking');
    expect(screen.getByRole('button', { name: '프로젝트: alpine-code' })).toHaveProperty('disabled', true);
    await screen.findByRole('button', { name: '세션으로 가기' });
  });

  it('comes first in the input bar, before the agent', async () => {
    mount();
    const chip = await screen.findByRole('button', { name: '프로젝트: alpine-code' });
    const agent = await screen.findByRole('button', { name: /^에이전트:/ });
    expect(chip.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the model beside the agent name', async () => {
    mount();
    const agent = await screen.findByRole('button', { name: /^에이전트:/ });
    expect(agent.textContent).toMatch(/· \S+/);
  });

  describe('with Alpine Cloud', () => {
    const CHAT = '동호회 사람들이 실시간 채팅으로 모임 장소를 정하는 앱을 만들고 싶어';
    const withPro: NewProjectScript = { ...fast, templates: ['blank', 'web-lite', 'web-pro'], address: true };

    it('makes a web app with its web address when signed in to Alpine, and shows the address the server made', async () => {
      const { sent } = mount(withPro, cloudScript({ signedIn: true, codeMs: 0 }));
      await send(IDEA);
      await create();
      expect(await screen.findByText('craft-booking.alpinesite.app')).toBeTruthy();
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(screen.getByText('인터넷 주소 만들기')).toBeTruthy();
      expect(sent('projects/create')).toHaveLength(1);
    });

    it('leaves no empty address tick behind when the server skipped the step', async () => {
      mount({ ...fast }, cloudScript({ signedIn: true }));
      await send(IDEA);
      await create();
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(screen.queryByText('인터넷 주소 만들기')).toBeNull();
    });

    it('asks a signed-out person to sign in before a realtime web app is made, then goes on by itself', async () => {
      vi.spyOn(window, 'open').mockImplementation(() => null);
      const { sent } = mount(withPro, cloudScript({ signInMs: 0 }));
      await send(CHAT);
      expect(await screen.findByRole('radio', { name: /^실시간 웹앱/ })).toHaveProperty('ariaChecked', 'true');
      await create();
      expect(await screen.findByText('실시간 웹앱을 쓰려면 Alpine 계정이 필요해요 (무료)')).toBeTruthy();
      expect(sent('projects/create')).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
      // A new account is on the free plan, so Pro is the next thing asked for.
      fireEvent.click(await screen.findByRole('button', { name: '7일 무료로 써 보기' }));
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(window.open).toHaveBeenCalledWith(expect.stringContaining('provider=google'), '_blank', 'noopener');
      expect(sent('projects/create')).toEqual([expect.objectContaining({ template: 'web-pro' })]);
    });

    it('offers Pro before a realtime web app on the free plan, and makes it when the free week has started', async () => {
      const { sent } = mount(withPro, cloudScript({ signedIn: true }));
      await send(CHAT);
      await create();
      expect(await screen.findByText(/^실시간 웹앱은 Pro에서 만들 수 있어요/)).toBeTruthy();
      expect(sent('projects/create')).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: '7일 무료로 써 보기' }));
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(sent('cloud/startTrial')).toHaveLength(1);
      expect(sent('projects/create')).toEqual([expect.objectContaining({ template: 'web-pro' })]);
    });

    it('goes straight on for a realtime web app when the account is on Pro', async () => {
      const { sent } = mount(withPro, cloudScript({ signedIn: true, plan: 'pro' }));
      await send(CHAT);
      await create();
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(sent('cloud/startTrial')).toEqual([]);
      expect(sent('projects/create')).toEqual([expect.objectContaining({ template: 'web-pro' })]);
    });

    it('does not make a realtime web app when the sheet is closed with 뒤로', async () => {
      const { sent } = mount(withPro, cloudScript());
      await send(CHAT);
      await create();
      fireEvent.click(await screen.findByRole('button', { name: '‹ 뒤로' }));
      await waitFor(() => expect(screen.queryByText('실시간 웹앱을 쓰려면 Alpine 계정이 필요해요 (무료)')).toBeNull());
      expect(screen.getByRole('button', { name: '만들기' })).toBeTruthy();
      expect(sent('projects/create')).toEqual([]);
    });

    it("offers Alpine's own Node.js before a web app is made on a Mac without one, and makes it when it is in", async () => {
      const { sent } = mount(fast, cloudScript({ node: 'missing', installMs: 25 }));
      await send(IDEA);
      await create();
      expect(await screen.findByText('웹앱을 만들려면 Node.js가 필요해요')).toBeTruthy();
      expect(screen.getByText('설치할까요? (약 50MB)')).toBeTruthy();
      expect(sent('projects/create')).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: '설치하고 이어가기' }));
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(sent('projects/installNodeTools')).toHaveLength(1);
      expect(sent('projects/create')).toHaveLength(1);
    });

    it('makes nothing when Node.js is put off, and says when the install fails', async () => {
      const failing = mount(fast, cloudScript({ node: 'missing', installMs: 25, installFails: true }));
      await send(IDEA);
      await create();
      fireEvent.click(await screen.findByRole('button', { name: '설치하고 이어가기' }));
      expect((await screen.findByRole('alert')).textContent).toContain('설치하지 못했어요');
      fireEvent.click(screen.getByRole('button', { name: '나중에' }));
      await waitFor(() => expect(screen.queryByText('웹앱을 만들려면 Node.js가 필요해요')).toBeNull());
      expect(failing.sent('projects/create')).toEqual([]);
      expect(screen.getByRole('button', { name: '만들기' })).toBeTruthy();
    });

    it('does not ask for Node.js for an empty project', async () => {
      const { sent } = mount(fast, cloudScript({ node: 'missing' }));
      await send(IDEA);
      fireEvent.click(await screen.findByRole('radio', { name: /빈 프로젝트/ }));
      await create();
      await screen.findByRole('button', { name: '세션으로 가기' });
      expect(sent('projects/installNodeTools')).toEqual([]);
    });
  });
});
