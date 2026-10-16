import type { CloneInfo } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { chatScript, PROJECTS } from '@/shared/server';

import { NewSession } from './NewSession';

const started = fn();

function Example() {
  return (
    <div className="flex h-screen">
      <NewSession project={PROJECTS[0]!} onProjectChange={fn()} onStarted={started} />
    </div>
  );
}

/** Board NewSession, without the rail (which picks the project) and the right panel. */
const meta = {
  title: 'New session/New session',
  component: Example,
  parameters: { server: chatScript(), layout: 'fullscreen' },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

/**
 * Board 새 세션 (에이전트 고르기): the chip in the input bar shows the agent the project used last; it opens the
 * agents with their model and what their tools let them do.
 */
export const PickingAnAgent: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /에이전트:|Agent:/ }));
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /꼼꼼한 검토자/ })).toBeVisible());
    expect(screen.getByRole('menuitemradio', { name: /홈페이지 담당/ })).toBeChecked();
    expect(screen.getByText(/이 프로젝트에서 마지막으로 씀/)).toBeVisible();
    await userEvent.click(screen.getByRole('menuitemradio', { name: /꼼꼼한 검토자/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /에이전트: 꼼꼼한 검토자/ })).toBeVisible());
  },
};

const RECEIVING: CloneInfo = {
  id: 'c1',
  address: 'acme/booking-web',
  name: 'booking-web',
  path: '/Users/me/AlpineCode/booking-web',
  state: 'receiving',
  percent: 43,
  received: 54_525_952,
};

function WhileCloning({ clone }: { clone: CloneInfo }) {
  const project = {
    path: clone.path,
    name: clone.name,
    branch: null,
    lastUsedAt: '',
    archived: false,
    lastAgent: null,
  };
  return (
    <div className="flex h-screen">
      <NewSession project={project} clone={clone} onProjectChange={fn()} onStarted={started} />
    </div>
  );
}

/** The project is still on its way: typing is fine, sending waits. */
export const Receiving: Story = { render: () => <WhileCloning clone={RECEIVING} /> };

export const NotReceived: Story = {
  render: () => (
    <WhileCloning
      clone={{ ...RECEIVING, state: 'failed', reason: 'unreachable', message: 'fatal: early EOF', received: null }}
    />
  ),
};

/** Sending makes the session and the message, then hands over the new session's id. */
export const Sent: Story = {
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/^(메시지|Message)$/), '안녕하세요{Enter}');
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
  },
};

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * Conversations other apps had in the project: one line under the suggestions naming the apps, opening the list.
 * Picking one brings it over and hands over the new session's id.
 */
export const FromOtherApps: Story = {
  parameters: {
    server: chatScript({
      importable: [
        { source: 'claude_code', id: 'c1', title: '로그인 화면 오류 고치기', updatedAt: ago(2), imported: null },
        { source: 'codex', id: 'x1', title: '결제 페이지 휴대폰 화면 정리', updatedAt: ago(26), imported: null },
        { source: 'claude_code', id: 'c2', title: 'README 다시 쓰기', updatedAt: ago(80), imported: null },
        { source: 'codex', id: 'x2', title: '배포 스크립트 점검', updatedAt: ago(200), imported: null },
      ],
    }),
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Claude Code·Codex에서 하던 대화 4개 이어 하기/ }));
    await userEvent.click(await screen.findByRole('button', { name: /결제 페이지 휴대폰 화면 정리/ }));
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
  },
};
