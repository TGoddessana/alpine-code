import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import {
  publishServer,
  scriptedConnection,
  ServerProvider,
  type CloudScriptOptions,
  type ServerConnection,
} from '@/shared/server';

import { PublishButton } from './PublishButton';

function mount(options: CloudScriptOptions = {}, locale: Locale = 'ko', withSession = true) {
  const base = scriptedConnection(publishServer({ publishMs: 0, ...options }));
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  /** The files' tree `publish/status` reports from now on, as if they were edited; unset keeps the script's. */
  const disk: { source?: string } = {};
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> });
      const answer = base.request(method, params);
      return method === 'publish/status' && disk.source
        ? answer.then((status) => ({ ...(status as object), source: disk.source }))
        : answer;
    },
    subscribe: base.subscribe,
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>
          <PublishButton cwd="/project" name="craft-booking" sessionId={withSession ? 'session-1' : null} defaultOpen />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  const sent = (method: string) => requests.filter((r) => r.method === method).map((r) => r.params);
  return { sent, disk };
}

const publish = () => screen.findByRole('button', { name: /^올리기/ }, { timeout: 4000 });
/** The sheet's 올리기 button (the top bar's trigger is the same word, so the one in the sheet is the last). */
const sheetPublish = async () => {
  await screen.findByText('보안 검사', undefined, { timeout: 4000 });
  return screen.getAllByRole('button', { name: /^올리기$/ }).at(-1)!;
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('올리기 sheet', () => {
  it('prepares when it opens, publishes with no confirms, and ends with the address and a QR code', async () => {
    const { sent } = mount();
    const button = await sheetPublish();
    expect(button).toHaveProperty('disabled', false);
    expect(sent('publish/prepare')).toHaveLength(1);
    expect(sent('publish/prepare')[0]).toMatchObject({ cwd: '/project', locale: 'ko' });
    fireEvent.click(button);
    expect(await screen.findByRole('img', { name: /QR/ }, { timeout: 4000 })).toBeTruthy();
    expect(sent('publish/run')).toEqual([expect.objectContaining({ cwd: '/project', deployId: 'dep_4', confirm: [] })]);
    expect(screen.getByText('craft-booking.alpinesite.app')).toBeTruthy();
  });

  it('reopening keeps a plan built from the files on disk, and builds again once they changed', async () => {
    const { sent, disk } = mount();
    await sheetPublish();
    expect(sent('publish/prepare')).toHaveLength(1);
    const toggle = () => fireEvent.click(screen.getAllByRole('button', { name: /^올리기/ })[0]!);

    toggle();
    toggle();
    await waitFor(() => expect(sent('publish/status').length).toBeGreaterThan(1));
    await sheetPublish();
    expect(sent('publish/prepare')).toHaveLength(1);

    // The same file edited again: the count stays, the tree does not.
    disk.source = 'tree_2';
    toggle();
    toggle();
    await waitFor(() => expect(sent('publish/prepare')).toHaveLength(2));
  });

  it('keeps 올리기 off until the dropped column is said OK, then sends that id', async () => {
    const { sent } = mount({ publish: 'drop' });
    const button = await sheetPublish();
    expect(screen.getByText(/"memo" 칸이 지워져요/)).toBeTruthy();
    expect(button as HTMLButtonElement).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(sent('publish/run')).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    fireEvent.click(button);
    await screen.findByRole('img', { name: /QR/ }, { timeout: 4000 });
    expect(sent('publish/run')[0]).toMatchObject({ confirm: ['drop_column:bookings.memo'] });
  });

  it('asks each kind of change separately and sends only what was confirmed', async () => {
    const { sent } = mount({ publish: 'confirms' });
    const button = await sheetPublish();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    expect(screen.getByText(/무엇을 바꾸는지 알 수 없는 변경/)).toBeTruthy();
    expect(screen.getByText('확인할 변경 5개가 남았어요')).toBeTruthy();
    expect(screen.getByText(/"nm" 칸 이름이 바뀌어요 \(새 이름: "name"\)/)).toBeTruthy();
    boxes.slice(0, 4).forEach((box) => fireEvent.click(box));
    expect(button as HTMLButtonElement).toHaveProperty('disabled', true);
    fireEvent.click(boxes[4]!);
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    fireEvent.click(button);
    await screen.findByRole('img', { name: /QR/ }, { timeout: 4000 });
    expect((sent('publish/run')[0]!.confirm as string[]).sort()).toEqual(
      [
        'data_change:bookings',
        'drop_column:bookings.memo',
        'drop_table:old_notes',
        'rename_column:bookings.nm',
        'unknown:0002_cleanup.sql',
      ].sort(),
    );
  });

  it('shows a finding in the app’s own words and lets publishing go on', async () => {
    mount({ publish: 'warning' });
    const button = await sheetPublish();
    expect(screen.getByText('GET /api/bookings는 로그인하지 않아도 데이터를 보여줘요.')).toBeTruthy();
    expect(button).toHaveProperty('disabled', false);
  });

  it('says a code it has no sentence for with the server’s own sentence', async () => {
    mount({ publish: 'advisor' });
    await sheetPublish();
    expect(screen.getByText('"bookings" 표에 행 단위 보안이 꺼져 있어요.')).toBeTruthy();
    expect(screen.getByText(/개발 서버가 꺼져 있어서/)).toBeTruthy();
  });

  it('speaks English when the app does', async () => {
    mount({ publish: 'warning' }, 'en');
    await screen.findByText('Security checks', undefined, { timeout: 4000 });
    expect(screen.getByText('GET /api/bookings shows data to people who are not signed in.')).toBeTruthy();
  });

  it('blocks on a secret key and sends the AI the sentence, where it is, and the fix', async () => {
    const { sent } = mount({ publish: 'blocked' });
    const fix = await screen.findByRole('button', { name: 'AI에게 고쳐 달라고 하기' }, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: '올리기' })).toBeNull(); // the sheet offers no 올리기 while blocked
    expect(screen.getByText(/결제 비밀 열쇠가 화면 코드에 들어 있어요/)).toBeTruthy();
    fireEvent.click(fix);
    await waitFor(() => expect(sent('session/send')).toHaveLength(1));
    const text = sent('session/send')[0]!.text as string;
    expect(sent('session/send')[0]!.sessionId).toBe('session-1');
    expect(text).toContain('결제 비밀 열쇠가 화면 코드에 들어 있어요');
    expect(text).toContain('assets/index-4f2a.js 1번째 줄');
    expect(text).toContain('Move the call that uses it into the Worker');
    expect(text).not.toContain('sk_live_abc');
    expect(sent('publish/run')).toEqual([]);
  });

  it('offers no AI fix when there is no session to send it to', async () => {
    mount({ publish: 'blocked' }, 'ko', false);
    await screen.findByText(/결제 비밀 열쇠가/, undefined, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: 'AI에게 고쳐 달라고 하기' })).toBeNull();
  });

  it('shows a failed build with its last lines and sends them to the AI', async () => {
    const { sent } = mount({ publish: 'build_failed' });
    expect(await screen.findByText('앱을 만들다가 멈췄어요', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/error TS2322/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'AI에게 고쳐 달라고 하기' }));
    await waitFor(() => expect(sent('session/send')).toHaveLength(1));
    expect(sent('session/send')[0]!.text).toContain('error TS2322');
  });

  it('says the old version stays online when the database change fails, and tries again', async () => {
    const { sent } = mount({ publish: 'run_failed' });
    fireEvent.click(await sheetPublish());
    expect(await screen.findByText('올리다가 멈췄어요', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/이전 버전이 그대로 떠 있어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 해 보기' }));
    await waitFor(() => expect(sent('publish/prepare')).toHaveLength(2));
  });

  it('asks a signed-out person to sign in first, and does not build', async () => {
    const { sent } = mount({ signedIn: false });
    expect(await screen.findByText('인터넷에 올리려면 Alpine 계정이 필요해요. 무료예요.')).toBeTruthy();
    expect(sent('publish/prepare')).toEqual([]);
  });

  it('offers Node.js when it is missing', async () => {
    const { sent } = mount({ node: 'missing' });
    expect(await screen.findByText('올리려면 Node.js가 필요해요')).toBeTruthy();
    expect(sent('publish/prepare')).toEqual([]);
  });

  it('shows the dot while changes wait, and no button for a project that is not a web app', async () => {
    mount();
    expect((await publish()).getAttribute('aria-label')).toContain('아직 안 올린 변경이 있어요');
    cleanup();
    mount({ publishReason: 'not_web' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /올리기/ })).toBeNull());
  });

  it('turns the button off for a taken-down app and says why, with a way to ask', async () => {
    const { sent } = mount({ publishReason: 'taken_down' });
    expect(await screen.findByText('이 앱은 운영 정책 때문에 내려갔어요.')).toBeTruthy();
    for (const button of screen.getAllByRole('button', { name: /^올리기$/ }).slice(-1))
      expect(button).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '문의하기' })).toBeTruthy();
    expect(sent('publish/prepare')).toEqual([]);
  });

  it('lists restore points and puts data and code back to the chosen one', async () => {
    const { sent } = mount();
    await sheetPublish();
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    const group = await screen.findByRole('radiogroup');
    expect(screen.getByText(/데이터와 코드가 그 때로 함께 돌아가요/)).toBeTruthy();
    const points = within(group).getAllByRole('radio');
    expect(points).toHaveLength(3);
    expect(screen.getByRole('button', { name: '이 때로 되돌리기' }) as HTMLButtonElement).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(points[1]!);
    fireEvent.click(screen.getByRole('button', { name: '이 때로 되돌리기' }));
    expect(await screen.findByText(/되돌렸어요/)).toBeTruthy();
    expect(sent('publish/restore')).toEqual([{ cwd: '/project', point: 'rp_8' }]);
  });
});
