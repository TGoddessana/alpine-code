import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import {
  mergeScripts,
  sessionInfo,
  sessionScript,
  setUpScript,
  type Item,
  type SessionScriptOptions,
} from '@/shared/server';

import { Session } from './Session';

const ID = 's-story';

const earlier: Item[] = [
  { id: 'i1', kind: 'user_message', text: '로그인 테스트가 가끔 실패해요. 원인을 찾아 주세요.' },
  { id: 'i2', kind: 'agent_message', text: '테스트 코드를 먼저 읽어 볼게요.\n타이밍 문제일 가능성이 커 보여요.' },
  {
    id: 'i3',
    kind: 'tool_call',
    name: 'read',
    args: { path: 'tests/login.test.ts' },
    status: 'done',
    result: null,
    images: 0,
  },
  {
    id: 'i4',
    kind: 'tool_call',
    name: 'grep',
    args: { pattern: 'waitFor' },
    status: 'done',
    result: null,
    images: 0,
  },
  {
    id: 'i5',
    kind: 'tool_call',
    name: 'edit',
    args: { path: 'tests/login.test.ts' },
    status: 'done',
    result: null,
    images: 0,
  },
  {
    id: 'i6',
    kind: 'approval',
    callId: 'i7',
    title: 'pnpm test 실행',
    preview: 'pnpm test login',
    previewKind: 'command',
    reason: null,
    remember: 'pnpm test',
    decision: 'allow',
    feedback: null,
  },
  {
    id: 'i7',
    kind: 'tool_call',
    name: 'bash',
    args: { command: 'pnpm test login' },
    status: 'error',
    result: '1 failed',
    images: 0,
  },
  { id: 'i8', kind: 'notice', text: 'AGENTS.md를 읽었어요', source: 'agents_md' },
  { id: 'i9', kind: 'compaction', beforeTokens: 96_000, afterTokens: 12_000 },
  { id: 'i10', kind: 'agent_message', text: '테스트가 아직 한 개 실패해요. 원인을 더 살펴볼게요.' },
  { id: 'i11', kind: 'run_stopped', reason: 'limit', message: null },
];

/** A session that exists on the server already, with `items`, and a server that plays turns at `options` speed. */
function server(items: Item[] = [], options: SessionScriptOptions = {}) {
  return mergeScripts(
    setUpScript(),
    sessionScript({ sessions: [{ info: sessionInfo({ id: ID, title: '로그인 테스트 고치기' }), items }], ...options }),
  );
}

const say = async (text: string) => {
  await userEvent.type(await screen.findByLabelText(/^(메시지|Message)$/), `${text}{Enter}`);
};

/** Boards for the session screen, without the rail and the right panel. */
const meta = {
  title: 'Session/Session',
  component: Session,
  args: { sessionId: ID },
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen">{Story()}</div>],
} satisfies Meta<typeof Session>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bubbles, prose, activity lines, my earlier choice, a notice, a compaction divider and why the run stopped. */
export const Conversation: Story = {
  parameters: { server: server(earlier) },
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /편집 1 · 실행 1 · 읽기 2|Edit 1 · Run 1 · Read 2/ }),
    );
    await waitFor(() => expect(screen.getAllByText(/완료|Done/).length).toBeGreaterThan(0));
  },
};

export const Empty: Story = { parameters: { server: server() } };

/** The reply arrives word by word, and the button is a stop button until it ends. */
export const StreamingReply: Story = {
  parameters: { server: server([], { stepMs: 250, wordMs: 120 }) },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await waitFor(() => expect(screen.getByRole('button', { name: /멈추기|Stop/ })).toBeVisible());
  },
};

/** While the run goes on, a line above the input says what it is doing, for how long and with how many tokens. */
export const ShowsProgress: Story = {
  parameters: { server: server([], { stepMs: 2000, wordMs: 300 }) },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await waitFor(() => expect(screen.getByText(/답을 쓰는 중|Writing the answer/)).toBeVisible());
    await waitFor(() => expect(screen.getByText(/이번 작업 [\d,]+ 토큰|[\d,]+ tokens this run/)).toBeVisible(), {
      timeout: 10_000,
    });
    await expect(screen.getByText(/기억 \d+%|Memory \d+%/)).toBeVisible();
  },
};

/** The dock above the input: what it wants to run and why, and my three answers. */
export const WaitingForApproval: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await waitFor(() => expect(screen.getByRole('region', { name: /승인 요청|Approval request/ })).toBeVisible());
  },
};

export const WaitingForAnEdit: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('README를 edit 해 주세요');
    await waitFor(() => expect(screen.getByRole('region', { name: /승인 요청|Approval request/ })).toBeVisible());
  },
};

/** Denying with a reason: the agent goes on with what I said. */
export const DeniedWithFeedback: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await userEvent.type(await screen.findByLabelText(/거절하는 이유|Why not/), '테스트는 내가 돌릴게요');
    await userEvent.click(screen.getByRole('button', { name: /^(거절|Deny)$/ }));
    await waitFor(() => expect(screen.getByText(/테스트는 내가 돌릴게요|You said/)).toBeVisible());
  },
};

/** Denying without a reason ends the run, and a quiet line says so. */
export const StoppedRun: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await userEvent.click(await screen.findByRole('button', { name: /^(거절|Deny)$/ }));
    await waitFor(() => expect(screen.getByText(/허용되지 않아서 멈췄어요|not allowed/)).toBeVisible());
  },
};

export const NotFound: Story = {
  args: { sessionId: 's-missing' },
  parameters: { server: server() },
  play: async () => {
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  },
};
