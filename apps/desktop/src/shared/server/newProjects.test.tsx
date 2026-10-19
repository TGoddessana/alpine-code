import type { ProjectInfo } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ServerError, type Notification, type ServerConnection } from './connection';
import { ServerProvider } from './context';
import { useCreateProject, useJudgeNewProject, type CreateStep } from './newProjects';
import { scriptedConnection } from './scripted';
import { sessionScript, type NewProjectScript } from './sessionScript';
import { useProjects } from './queries';
import { useSessions } from './sessions';

const PROJECT: ProjectInfo = {
  path: '/Users/me/AlpineCode/craft-booking',
  name: 'craft-booking',
  branch: 'main',
  lastUsedAt: '',
  archived: false,
  lastAgent: null,
};

/** A server that answers what the test says, records every request, and lets the test send notifications. */
function harness(answers: Record<string, (params: unknown) => unknown | Promise<unknown>> = {}) {
  const listeners = new Set<(n: Notification) => void>();
  const requests: { method: string; params: unknown }[] = [];
  const notify = (notification: Notification) => listeners.forEach((listener) => listener(notification));
  const connection = {
    async request(method: string, params: unknown) {
      requests.push({ method, params });
      const answer = answers[method];
      if (!answer) throw new Error(`no answer for ${method}`);
      return answer(params);
    },
    subscribe(listener: (n: Notification) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as ServerConnection;
  return { connection, requests, notify, listeners };
}

function wrap(connection: ServerConnection) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>{children}</ServerProvider>
    </QueryClientProvider>
  );
  return { wrapper, client };
}

const step = (id: string, which: CreateStep, project = PROJECT): Notification => ({
  method: 'projects/createChanged',
  params: { id, step: which, project },
});

describe('useJudgeNewProject', () => {
  it('asks projects/judge and resolves with the judgement', async () => {
    const judgement = {
      kind: 'new',
      template: 'web-lite',
      reason: '로그인과 예약 저장이면 Lite로 충분해요.',
      name: 'craft-booking',
    };
    const { connection, requests } = harness({ 'projects/judge': () => ({ judgement }) });
    const { result } = renderHook(() => useJudgeNewProject(), { wrapper: wrap(connection).wrapper });

    const params = { text: '공방 예약 페이지', locale: 'ko', cwd: '/Users/me/alpine-code' };
    await act(async () => expect(await result.current.mutateAsync(params)).toEqual(judgement));
    expect(requests).toEqual([{ method: 'projects/judge', params }]);
  });

  it('rejects with the server error, for the caller to decide what it means', async () => {
    const error = new ServerError(-32000, 'The model could not be reached', { reason: 'model_failed' });
    const { connection } = harness({
      'projects/judge': () => {
        throw error;
      },
    });
    const { result } = renderHook(() => useJudgeNewProject(), { wrapper: wrap(connection).wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ text: 'x', locale: 'en' })).rejects.toBe(error);
    });
  });
});

describe('useCreateProject', () => {
  it('sends a fresh id, tells each step of its own call as it is announced, and resolves with the session', async () => {
    let id = '';
    const { connection, requests, notify } = harness({
      'projects/create': async (params) => {
        id = (params as { id: string }).id;
        notify(step('someone-else', 'folder'));
        notify(step(id, 'folder'));
        notify(step(id, 'agent'));
        return { project: PROJECT, sessionId: 'abc123' };
      },
      'projects/list': () => ({ projects: [PROJECT], clones: [] }),
      'session/list': () => ({ sessions: [] }),
    });
    const { result } = renderHook(() => useCreateProject(), { wrapper: wrap(connection).wrapper });

    const heard: [CreateStep, string][] = [];
    const input = {
      idea: '공방 예약 페이지',
      template: 'web-lite',
      name: 'craft-booking',
      agent: 'a-site',
      mode: 'accept_edits',
      onStep: (which: CreateStep, project: ProjectInfo) => heard.push([which, project.name]),
    } as const;
    await act(async () =>
      expect(await result.current.mutateAsync(input)).toEqual({ project: PROJECT, sessionId: 'abc123' }),
    );

    expect(heard).toEqual([
      ['folder', 'craft-booking'],
      ['agent', 'craft-booking'],
    ]);
    expect(requests[0]).toEqual({
      method: 'projects/create',
      params: {
        idea: input.idea,
        template: 'web-lite',
        name: 'craft-booking',
        agent: 'a-site',
        mode: 'accept_edits',
        id,
      },
    });
    expect(id).toMatch(/\S{8,}/);
  });

  it('stops listening when the request ends, and uses another id for the next one', async () => {
    const ids: string[] = [];
    const { connection, listeners } = harness({
      'projects/create': (params) => {
        ids.push((params as { id: string }).id);
        return { project: PROJECT, sessionId: 's' };
      },
      'projects/list': () => ({ projects: [], clones: [] }),
      'session/list': () => ({ sessions: [] }),
    });
    const { result } = renderHook(() => useCreateProject(), { wrapper: wrap(connection).wrapper });
    const input = { idea: 'x', template: 'blank', name: 'x' } as const;
    const before = listeners.size;
    await act(async () => void (await result.current.mutateAsync(input)));
    await act(async () => void (await result.current.mutateAsync(input)));
    expect(listeners.size).toBe(before);
    expect(new Set(ids).size).toBe(2);
  });

  it('refreshes the projects and the sessions before it resolves, so the new project can be shown at once', async () => {
    let made = false;
    const { connection, requests } = harness({
      'projects/create': () => {
        made = true;
        return { project: PROJECT, sessionId: 'abc123' };
      },
      // A server that takes a moment: the list is only current once it has been asked again and has answered.
      'projects/list': async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { projects: made ? [PROJECT] : [], clones: [] };
      },
      'session/list': () => ({ sessions: [] }),
    });
    // The rail's projects and the sessions are on screen when a project is made.
    const { wrapper, client } = wrap(connection);
    const mounted = renderHook(
      () => ({ projects: useProjects(), sessions: useSessions(), create: useCreateProject() }),
      { wrapper },
    );
    await waitFor(() =>
      expect(mounted.result.current.projects.isSuccess && mounted.result.current.sessions.isSuccess).toBe(true),
    );
    expect(mounted.result.current.projects.data?.projects).toEqual([]);

    await act(async () => {
      await mounted.result.current.create.mutateAsync({ idea: 'x', template: 'blank', name: 'x' });
      // Already current when the call resolves, not some time after.
      expect(client.getQueryData(['projects'])).toEqual({ projects: [PROJECT], clones: [] });
    });
    expect(requests.filter((r) => r.method === 'session/list')).toHaveLength(2);
  });

  it('rejects with the server error, and refreshes too: the project may have been made before the session failed', async () => {
    const error = new ServerError(-32000, 'No model', { reason: 'model_failed' });
    const { connection, requests } = harness({
      'projects/create': () => {
        throw error;
      },
      'projects/list': () => ({ projects: [PROJECT], clones: [] }),
      'session/list': () => ({ sessions: [] }),
    });
    const mounted = renderHook(
      () => ({ projects: useProjects(), sessions: useSessions(), create: useCreateProject() }),
      {
        wrapper: wrap(connection).wrapper,
      },
    );
    await waitFor(() =>
      expect(mounted.result.current.projects.isSuccess && mounted.result.current.sessions.isSuccess).toBe(true),
    );

    await act(async () => {
      await expect(mounted.result.current.create.mutateAsync({ idea: 'x', template: 'blank', name: 'x' })).rejects.toBe(
        error,
      );
    });
    expect(requests.filter((r) => r.method === 'session/list')).toHaveLength(2);
    expect(requests.filter((r) => r.method === 'projects/list')).toHaveLength(2);
  });
});

describe('the scripted new-project server', () => {
  const fast: NewProjectScript = { judgeMs: 0, createMs: 0 };
  const judge = (text: string, newProject = fast, locale = 'ko') =>
    scriptedConnection(sessionScript({ newProject })).request('projects/judge', { text, locale });

  it('judges a new app with a template, a reason in the language, and a folder name', async () => {
    const text = '동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘';
    expect((await judge(text)).judgement).toEqual({
      kind: 'new',
      template: 'web-lite',
      reason: '로그인과 예약 저장이면 Lite로 충분해요.',
      name: 'craft-booking',
    });
    expect((await judge(text, fast, 'en')).judgement).toMatchObject({ kind: 'new', template: 'web-lite' });
  });

  it('only recommends templates the server has, and is unsure (change) otherwise', async () => {
    const chat = '동호회 사람들이 실시간 채팅으로 정하는 앱을 만들고 싶어';
    expect((await judge(chat)).judgement).toMatchObject({ kind: 'new', template: 'web-lite' });
    expect((await judge(chat, { ...fast, templates: ['web-lite', 'web-pro'] })).judgement).toMatchObject({
      kind: 'new',
      template: 'web-pro',
    });
    expect((await judge('엑셀 정리 자동화 스크립트를 만들어 줘')).judgement).toMatchObject({
      kind: 'new',
      template: 'blank',
    });
    expect(
      (await judge('엑셀 정리 자동화 스크립트를 만들어 줘', { ...fast, templates: ['web-lite'] })).judgement,
    ).toMatchObject({
      template: 'web-lite',
    });
    expect((await judge('첫 화면 버튼을 더 크게 바꿔 줘')).judgement).toEqual({ kind: 'change' });
    expect((await judge('안녕하세요')).judgement).toEqual({ kind: 'change' });
    expect((await judge('앱을 만들어 줘', { ...fast, templates: [] })).judgement).toEqual({ kind: 'change' });
  });

  it('is always a new app when the person chose 새로 만들기 (newProject), and the rules only pick the setup', async () => {
    const asNew = (text: string, newProject = fast) =>
      scriptedConnection(sessionScript({ newProject })).request('projects/judge', {
        text,
        locale: 'ko',
        newProject: true,
      });
    expect((await asNew('첫 화면 버튼을 더 크게 바꿔 줘')).judgement).toMatchObject({
      kind: 'new',
      template: 'web-lite',
    });
    expect((await asNew('안녕하세요')).judgement).toMatchObject({ kind: 'new', template: 'web-lite' });
    expect(
      (await asNew('동호회 채팅 앱', { ...fast, templates: ['blank', 'web-lite', 'web-pro'] })).judgement,
    ).toMatchObject({ kind: 'new', template: 'web-pro' });
    expect((await asNew('엑셀 정리 자동화 스크립트')).judgement).toMatchObject({ kind: 'new', template: 'blank' });
    expect((await asNew('안녕하세요', { ...fast, templates: ['blank'] })).judgement).toMatchObject({
      kind: 'new',
      template: 'blank',
    });
    expect((await asNew('안녕하세요', { ...fast, templates: [] })).judgement).toEqual({ kind: 'change' });
  });

  it('fails the way a model that cannot be reached does', async () => {
    await expect(judge('앱을 만들어 줘', { ...fast, judgeFails: true })).rejects.toMatchObject({
      data: { reason: 'model_failed' },
    });
  });

  it('creates: announces the folder and the agent, starts a session on the idea in the new folder, names it -2 when taken', async () => {
    const connection = scriptedConnection(sessionScript({ newProject: fast }));
    const heard: Notification[] = [];
    const params = { id: 'p1', idea: '공방 예약 페이지', template: 'web-lite', name: 'craft-booking' } as const;
    const sessionEvents: unknown[] = [];
    connection.subscribe((n) => (n.method === 'projects/createChanged' ? heard : sessionEvents).push(n));

    const result = await connection.request('projects/create', params);
    expect(result.project.path).toBe('/Users/me/AlpineCode/craft-booking');
    expect(result.sessionId).toMatch(/^s-/);
    expect(heard.map((n) => (n.params as { step: string }).step)).toEqual(['folder', 'agent']);
    expect(heard.every((n) => (n.params as { id: string }).id === 'p1')).toBe(true);
    const snapshot = await connection.request('session/open', { sessionId: result.sessionId });
    expect(snapshot.info.cwd).toBe('/Users/me/AlpineCode/craft-booking');

    const again = await connection.request('projects/create', { ...params, id: 'p2' });
    expect(again.project.name).toBe('craft-booking-2');
  });

  it('announces the web address between them for a signed-in server, and passes the agent and the mode on', async () => {
    const connection = scriptedConnection(sessionScript({ newProject: { ...fast, address: true } }));
    const steps: string[] = [];
    connection.subscribe(
      (n) => n.method === 'projects/createChanged' && steps.push((n.params as { step: string }).step),
    );
    const { sessionId } = await connection.request('projects/create', {
      id: 'p1',
      idea: 'x',
      template: 'blank',
      name: 'x',
      agent: 'default',
      mode: 'accept_edits',
    });
    expect(steps).toEqual(['folder', 'address', 'agent']);
    expect((await connection.request('session/open', { sessionId })).info).toMatchObject({ mode: 'accept_edits' });
  });

  it('refuses a template it does not have, and fails before or after the folder as scripted', async () => {
    const make = (newProject: Parameters<typeof sessionScript>[0] = {}) =>
      scriptedConnection(sessionScript({ newProject: { ...fast, ...newProject?.newProject } }));
    const params = { id: 'p1', idea: 'x', template: 'web-lite', name: 'x' } as const;
    await expect(make().request('projects/create', { ...params, template: 'mobile' })).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });

    const noFolder = make({ newProject: { createFails: 'folder' } });
    const steps: string[] = [];
    noFolder.subscribe((n) => steps.push((n.params as { step: string }).step));
    await expect(noFolder.request('projects/create', params)).rejects.toBeInstanceOf(ServerError);
    expect(steps).toEqual([]);

    const noSession = make({ newProject: { createFails: 'session' } });
    noSession.subscribe((n) => steps.push((n.params as { step: string }).step));
    await expect(noSession.request('projects/create', params)).rejects.toBeInstanceOf(ServerError);
    expect(steps).toEqual(['folder']);
  });
});
