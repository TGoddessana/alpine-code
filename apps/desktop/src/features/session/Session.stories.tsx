import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
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
    result: Array.from({ length: 24 }, (_, i) => `${String(i + 1).padStart(3)}\t// line ${i + 1}`).join('\n'),
    images: 0,
  },
  {
    id: 'i4',
    kind: 'tool_call',
    name: 'grep',
    args: { pattern: 'waitFor', path: 'tests' },
    status: 'done',
    result: 'tests/login.test.ts:12:  await waitFor(() => screen.getByText("Welcome"));',
    images: 0,
  },
  {
    id: 'i5a',
    kind: 'approval',
    callId: 'i5',
    title: 'Edit tests/login.test.ts',
    preview:
      '--- a/tests/login.test.ts\n+++ b/tests/login.test.ts\n@@ -12 +12 @@\n-  await waitFor(() => screen.getByText("Welcome"));\n+  await screen.findByText("Welcome", {}, { timeout: 3000 });\n',
    previewKind: 'diff',
    reason: null,
    remember: 'edit',
    decision: 'allow',
    feedback: null,
    tool: 'edit',
    args: { path: 'tests/login.test.ts' },
  },
  {
    id: 'i5',
    kind: 'tool_call',
    name: 'edit',
    args: { path: 'tests/login.test.ts' },
    status: 'done',
    result: 'Edited tests/login.test.ts',
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
    tool: 'bash',
    args: { command: 'pnpm test login' },
  },
  {
    id: 'i7',
    kind: 'tool_call',
    name: 'bash',
    args: { command: 'pnpm test login' },
    status: 'error',
    result: [
      ' RUN  v3.2.4 /Users/me/app',
      '',
      ' ✓ tests/signup.test.ts (6 tests) 412ms',
      ' ✓ tests/session.test.ts (5 tests) 380ms',
      ' ❯ tests/login.test.ts (1 test | 1 failed) 3012ms',
      '   × shows the welcome message',
      '     TimeoutError: Welcome not found in 3000ms',
      '',
      ' Tests  1 failed | 11 passed (12)',
    ].join('\n'),
    images: 0,
  },
  {
    id: 'i7a',
    kind: 'approval',
    callId: 'i7b',
    title: 'Run command',
    preview: 'pnpm lint',
    previewKind: 'command',
    reason: null,
    remember: 'pnpm lint',
    decision: 'deny',
    feedback: '린트는 지금 안 돌려도 돼요',
    tool: 'bash',
    args: { command: 'pnpm lint' },
  },
  {
    id: 'i7b',
    kind: 'tool_call',
    name: 'bash',
    args: { command: 'pnpm lint' },
    status: 'denied',
    result: 'The user declined this tool call. They said: 린트는 지금 안 돌려도 돼요',
    images: 0,
  },
  { id: 'i8', kind: 'notice', text: 'AGENTS.md를 읽었어요', source: 'agents_md' },
  { id: 'i9', kind: 'compaction', beforeTokens: 96_000, afterTokens: 12_000 },
  { id: 'i10', kind: 'agent_message', text: '테스트가 아직 한 개 실패해요. 원인을 더 살펴볼게요.' },
  { id: 'i11', kind: 'run_stopped', reason: 'limit', message: null },
];

/** A long answer with every kind of block the chat draws. */
const MARKDOWN = `### 로그인 버튼 고치기

버튼을 눌러도 **아무 반응이 없던** 이유는 두 가지예요.

1. 클릭이 \`form\` 제출과 겹쳐서 페이지가 새로고침됐어요
2. 비밀번호 확인 함수가 *빈 값*을 통과시켰어요
   - 공백만 넣어도 통과했어요

이렇게 바꿨어요.

\`\`\`ts
function onSubmit(event: SubmitEvent) {
  event.preventDefault(); // 새로고침 막기
  if (!password.trim()) return showError('비밀번호를 입력하세요');
  login(email, password);
}
\`\`\`

| 파일 | 바뀐 것 |
|---|---|
| \`LoginForm.tsx\` | 새로고침 막기 |
| \`validate.ts\` | 빈 값 거르기 |

> 테스트는 \`pnpm test login\`으로 돌렸고 모두 통과했어요.

자세한 설명은 [React 문서](https://react.dev/reference/react-dom/components/form)에 있어요. 한 번 직접 눌러 보시고, 이상하면 알려 주세요.

---

### 다음에 하면 좋은 것

- 로그인 실패 메시지를 한국어로 바꾸기
- 비밀번호 보기 버튼 넣기
`;

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

/**
 * Boards for the session screen, without the rail and the right panel. The profile chip in the input bar is a link,
 * so each story makes a router.
 */
const meta = {
  title: 'Session/Session',
  component: Session,
  args: { sessionId: ID },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({ component: () => <div className="flex h-screen">{Story()}</div> }),
      });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof Session>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Bubbles, prose, a stretch of tool calls as one line that opens into Claude Code's layout (a read's count that
 * opens, an edit's diff, a failed command's output cut to its first lines, a denied one with what I said), a notice,
 * a compaction divider and why the run stopped.
 */
export const Conversation: Story = {
  parameters: { server: server(earlier) },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /명령 2개 실행.*실패 1.*안 함 1|Ran 2 commands/ }));
    await expect(await screen.findByText(/린트는 지금 안 돌려도 돼요/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /24줄 읽음|Read 24 lines/ }));
    await waitFor(() => expect(screen.getByText(/line 24/)).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /… 5줄 더 보기|… 5 more lines/ }));
    await waitFor(() => expect(screen.getByText(/Tests {2}1 failed/)).toBeVisible());
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

/** A finished answer in markdown: headings, lists, code with colours and a copy button, a table, a quote, a link. */
export const MarkdownAnswer: Story = {
  parameters: {
    server: server([
      { id: 'm1', kind: 'user_message', text: '로그인 버튼이 안 눌려요' },
      { id: 'm2', kind: 'agent_message', text: MARKDOWN },
    ]),
  },
  play: async () => {
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await expect(screen.getByRole('button', { name: /ts 코드 복사|Copy ts code/ })).toBeVisible();
  },
};

/**
 * A long answer streaming in the way models send it (bursts and pauses, about 80 tokens a second, the answer three
 * times over): it should flow evenly, with the view following the end.
 */
export const StreamingMarkdown: Story = {
  parameters: { server: server([], { stepMs: 300, wordMs: 12, reply: [MARKDOWN, MARKDOWN, MARKDOWN].join('\n\n') }) },
  play: async () => {
    await say('로그인 버튼이 안 눌려요');
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0), { timeout: 10_000 });
  },
};

/** While the run goes on, the last line of the chat says what it is doing, for how long and with how many tokens. */
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

/** A call that waits for my answer, in the chat where it will run: what it would run and why, and my answers. */
export const WaitingForApproval: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    const card = await screen.findByRole('region', { name: /승인 요청|Approval request/ }, { timeout: 10_000 });
    await expect(card).toBeVisible();
    await expect(screen.getByPlaceholderText(/어떻게 다르게 할지|Say what to do instead/)).toBeVisible();
  },
};

export const WaitingForAnEdit: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('README를 edit 해 주세요');
    await waitFor(() => expect(screen.getByRole('region', { name: /승인 요청|Approval request/ })).toBeVisible(), {
      timeout: 10_000,
    });
  },
};

/** Writing in the input while a call waits skips it and tells the agent what to do instead; the run goes on. */
export const AnsweredInTheInput: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await screen.findByRole('region', { name: /승인 요청|Approval request/ }, { timeout: 10_000 });
    await say('테스트는 내가 돌릴게요');
    await waitFor(() => expect(screen.getByText(/You said: 테스트는 내가 돌릴게요/)).toBeVisible(), {
      timeout: 10_000,
    });
  },
};

/** Skipping a call does not stop the run: the agent carries on without it. */
export const Skipped: Story = {
  parameters: { server: server() },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await userEvent.click(await screen.findByRole('button', { name: /^(건너뛰기|Skip)$/ }, { timeout: 10_000 }));
    await waitFor(() => expect(screen.getByText(/I carried on without it/)).toBeVisible(), { timeout: 10_000 });
    await expect(screen.getByRole('button', { name: /안 함 1|1 not run/ })).toBeVisible();
  },
};

/** Esc stops the run from anywhere on the screen, like the stop button; a quiet line says it stopped. */
export const StoppedWithEsc: Story = {
  parameters: { server: server([], { stepMs: 1500, wordMs: 300 }) },
  play: async () => {
    await say('테스트를 돌려 주세요');
    await expect(await screen.findByRole('button', { name: /멈추기|Stop/ }, { timeout: 10_000 })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByText(/^(멈췄어요|Stopped)$/)).toBeVisible(), { timeout: 10_000 });
  },
};

/** Board LimitHit, as far as the app goes today: a ChatGPT session that stopped at the plan's limit. */
export const ChatGPTLimitHit: Story = {
  parameters: {
    server: mergeScripts(
      setUpScript(),
      sessionScript({
        sessions: [
          {
            info: sessionInfo({ id: ID, title: '세션 목록이 사라지는 문제', model: 'chatgpt/gpt-5.5' }),
            items: [
              { id: 'l1', kind: 'user_message', text: '세션 목록이 가끔 사라지는 문제 고쳐 줘.' },
              { id: 'l2', kind: 'agent_message', text: '원인을 찾았어요. 파싱이 실패하면 빈 목록을 돌려줘요.' },
              { id: 'l3', kind: 'run_stopped', reason: 'plan_limit', message: 'The plan is used up.' },
            ],
          },
        ],
      }),
    ),
  },
  play: async () => {
    await waitFor(() => expect(screen.getByText(/ChatGPT 사용량 한도|ChatGPT usage limit/)).toBeVisible());
  },
};

export const NotFound: Story = {
  args: { sessionId: 's-missing' },
  parameters: { server: server() },
  play: async () => {
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  },
};
