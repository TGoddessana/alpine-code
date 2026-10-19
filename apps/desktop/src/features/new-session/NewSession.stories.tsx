import type { CloneInfo } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test';

import { chatScript, PROJECTS } from '@/shared/server';

import { NewSession } from './NewSession';

const started = fn();

function Example({ signedIn = false, proReady = false }: { signedIn?: boolean; proReady?: boolean }) {
  return (
    <div className="flex h-screen">
      <NewSession project={PROJECTS[0]!} onProjectChange={fn()} onStarted={started} cloud={{ signedIn, proReady }} />
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

async function send(text: string) {
  fireEvent.input(await screen.findByLabelText(/^(메시지|Message)$/), { target: { value: text } });
  await userEvent.click(screen.getByRole('button', { name: /^(보내기|Send)$/ }));
}

/** Sending a new app idea: the agent judges it, then the four setups come with its pick chosen and why. */
export const NewAppJudged: Story = {
  args: { signedIn: true },
  play: async () => {
    await send('동네 공방 원데이 클래스를 예약받고, 자리가 차면 대기 명단에 올려 주는 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getByText(/Lite로 충분해요|well within Lite/)).toBeInTheDocument(), {
      timeout: 5000,
    });
  },
};

/** The moment in between: what I sent, and the agent judging it. */
export const Judging: Story = {
  args: { signedIn: true },
  play: async () => {
    await send('동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
  },
};

/** With paid plans open, an idea with chat gets Pro chosen, with its trial. */
export const ProRecommended: Story = {
  args: { signedIn: true, proReady: true },
  parameters: { server: chatScript({ newProject: { templates: ['blank', 'web-lite', 'web-pro'] } }) },
  play: async () => {
    await send('동호회 사람들이 실시간 채팅으로 모임 장소를 정하고 사진을 올리는 앱을 만들고 싶어');
    await waitFor(() => expect(screen.getByText(/주고받는 기능이 있어서|exchange things live/)).toBeInTheDocument(), {
      timeout: 5000,
    });
  },
};

/** Work on this project: after the judging it starts a session, as before. */
export const ChangeJudged: Story = {
  play: async () => {
    started.mockClear();
    await send('첫 화면 버튼을 더 크게 바꿔 줘');
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)), { timeout: 5000 });
  },
};

/** 만들기: the folder, the web address, then the AI starts. */
export const CreatingFromJudgement: Story = {
  args: { signedIn: true },
  parameters: { server: chatScript({ newProject: { address: true } }) },
  play: async () => {
    started.mockClear();
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByText(/AlpineCode\/craft-booking/)).toBeInTheDocument(), { timeout: 5000 });
    const open = await screen.findByRole('button', { name: /세션으로 가기|Go to the session/ }, { timeout: 8000 });
    await userEvent.click(open);
    expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/));
  },
};

/** 만들기 without signing in to Alpine: the folder, then the AI starts. No web address yet. */
export const CreatingOnThisMac: Story = {
  play: async () => {
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: /세션으로 가기|Go to the session/ })).toBeInTheDocument(),
      { timeout: 6000 },
    );
    expect(screen.queryByText(/인터넷 주소 만들기|Make the web address/)).not.toBeInTheDocument();
  },
};

/** The model could not be asked: it counts as work on this project, so the message still starts a session. */
export const JudgingFailed: Story = {
  parameters: { server: chatScript({ newProject: { judgeFails: true } }) },
  play: async () => {
    started.mockClear();
    await send('공방 수업 예약 페이지를 만들어 줘');
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)), { timeout: 5000 });
  },
};

/** The project could not be made: nothing was made, a plain message says so, and the way back shows the setups again. */
export const CreatingFailed: Story = {
  parameters: { server: chatScript({ newProject: { createFails: 'folder' } }) },
  play: async () => {
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    await userEvent.click(screen.getByRole('button', { name: /^(돌아가기|Go back)$/ }));
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: /구성|Setup/ })).toBeInTheDocument());
  },
};

/** The project was made, but the AI could not start on the idea: the project is there, and the button goes to it. */
export const CreatedButNotStarted: Story = {
  parameters: { server: chatScript({ newProject: { createFails: 'session' } }) },
  play: async () => {
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: /프로젝트 열기|Open the project/ })).toBeInTheDocument(),
      {
        timeout: 5000,
      },
    );
  },
};

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

/** Sending something that is not a new app: after the judging, the session and the message, then its id. */
export const Sent: Story = {
  play: async () => {
    started.mockClear();
    await userEvent.type(await screen.findByLabelText(/^(메시지|Message)$/), '안녕하세요{Enter}');
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)), { timeout: 5000 });
  },
};

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * Conversations other apps had in the project: one line under the cards naming the apps, opening the list.
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
    started.mockClear();
    await userEvent.click(await screen.findByRole('button', { name: /Claude Code·Codex에서 하던 대화 4개 이어 하기/ }));
    await userEvent.click(await screen.findByRole('button', { name: /결제 페이지 휴대폰 화면 정리/ }));
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
  },
};
