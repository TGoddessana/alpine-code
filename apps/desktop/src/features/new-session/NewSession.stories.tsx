import type { CloneInfo, ProjectInfo } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test';

import {
  chatScript,
  cloudScript,
  mergeScripts,
  PROJECTS,
  type CloudScriptOptions,
  type SessionScriptOptions,
} from '@/shared/server';

import { NewSession } from './NewSession';

const started = fn();

/** The scripted server with an Alpine account (or not) behind it: the screen reads the sign-in from `cloud/status`. */
const server = (options: SessionScriptOptions = {}, cloud: CloudScriptOptions = { signedIn: true }) =>
  mergeScripts(chatScript(options), cloudScript(cloud));

function Example({
  project = PROJECTS[0]!,
}: {
  /** `null`: making a new project (새로 만들기). */
  project?: ProjectInfo | null;
}) {
  return (
    <div className="flex h-screen">
      <NewSession project={project} onProjectChange={fn()} onNewProject={fn()} onStarted={started} />
    </div>
  );
}

/**
 * Board NewSession, without the rail and the right panel: the heading, what the screen says meanwhile and the input in
 * the middle of the window. The first chip in the input names the folder it starts in, the agent chip names the model.
 */
const meta = {
  title: 'New session/New session',
  component: Example,
  parameters: { server: chatScript(), layout: 'fullscreen' },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

/** The folder chip lists the projects with the current one checked; the last row adds one. */
export const PickingAProject: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(프로젝트|Project):/ }));
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /docs-site/ })).toBeVisible());
    expect(screen.getByRole('menuitemradio', { name: /alpine-code/ })).toBeChecked();
    expect(screen.getByRole('menuitem', { name: /프로젝트 추가…|Add a project…/ })).toBeVisible();
  },
};

/** 프로젝트 추가… opens the same dialog as the rail's +, where 새로 만들기 is the first row. */
export const AddingAProject: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(프로젝트|Project):/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /프로젝트 추가…|Add a project…/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^(새로 만들기|Make a new project)/ })).toBeVisible(),
    );
  },
};

/** 새로 만들기: no project yet. The heading asks what to make, and the folder chip says 새 프로젝트. */
export const MakingNew: Story = { args: { project: null } };

/** 새로 만들기, sent: the agent only picks a setup, shown with its pick and why, and no way back to a project. */
export const MakingNewJudged: Story = {
  args: { project: null },
  parameters: { server: server() },
  play: async () => {
    await send('동네 공방 원데이 클래스를 예약받고, 자리가 차면 대기 명단에 올려 주는 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getByText(/웹앱으로 충분해요|well within a web app/)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(
      screen.queryByRole('button', { name: /아니요, 이 프로젝트에서 할게요|No, work on this project/ }),
    ).toBeNull();
  },
};

/** 새로 만들기 when the agent could not be asked: the setups show with the web app chosen, and nobody recommends it. */
export const MakingNewJudgingFailed: Story = {
  args: { project: null },
  parameters: { server: chatScript({ newProject: { judgeFails: true } }) },
  play: async () => {
    await send('공방 수업 예약 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: /구성|Setup/ })).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByText(/추천|Recommended/)).toBeNull();
  },
};

/** 새로 만들기, 만들기: the folder, then the AI starts; the session opens from there. */
export const MakingNewCreated: Story = {
  args: { project: null },
  play: async () => {
    started.mockClear();
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    const open = await screen.findByRole('button', { name: /세션으로 가기|Go to the session/ }, { timeout: 8000 });
    await userEvent.click(open);
    expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/));
  },
};

async function send(text: string) {
  fireEvent.input(await screen.findByLabelText(/^(메시지|Message)$/), { target: { value: text } });
  await userEvent.click(screen.getByRole('button', { name: /^(보내기|Send)$/ }));
}

/** Sending a new app idea: the agent judges it, then the four setups come with its pick chosen and why. */
export const NewAppJudged: Story = {
  parameters: { server: server() },
  play: async () => {
    await send('동네 공방 원데이 클래스를 예약받고, 자리가 차면 대기 명단에 올려 주는 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getByText(/웹앱으로 충분해요|well within a web app/)).toBeInTheDocument(), {
      timeout: 5000,
    });
  },
};

/** The moment in between: what I sent, and the agent judging it. */
export const Judging: Story = {
  parameters: { server: server() },
  play: async () => {
    await send('동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘');
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
  },
};

/** An idea with chat gets the realtime web app chosen, with its trial. */
export const ProRecommended: Story = {
  parameters: { server: server({ newProject: { templates: ['blank', 'web-lite', 'web-pro'] } }) },
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
  parameters: { server: server({ newProject: { address: true } }) },
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

/**
 * Decision 23: a realtime web app needs the Alpine account. Signed out, 만들기 opens the sign-in sheet with the
 * reason; the browser sign-in comes back on Free, so the Pro sheet follows, and the trial makes the project.
 */
export const RealtimeNeedsSignIn: Story = {
  parameters: {
    server: server({ newProject: { templates: ['blank', 'web-lite', 'web-pro'], address: true } }, { signInMs: 600 }),
  },
  play: async () => {
    started.mockClear();
    await send('동호회 사람들이 실시간 채팅으로 모임 장소를 정하는 앱을 만들고 싶어');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await userEvent.click(await screen.findByRole('button', { name: /Google로 계속하기|Continue with Google/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: /7일 무료로 써 보기|Try it free for 7 days/ }, { timeout: 8000 }),
    );
    await waitFor(() => expect(screen.getByText(/alpinesite\.app/)).toBeInTheDocument(), { timeout: 8000 });
  },
};

/** 만들기 with a web app on a Mac that has no Node.js: Alpine offers its own copy first, with the download's progress. */
export const NodeMissing: Story = {
  parameters: {
    server: server({ newProject: { address: true } }, { signedIn: true, node: 'missing', installMs: 1500 }),
  },
  play: async () => {
    await send('공방 수업 예약 페이지를 만들어 줘');
    await userEvent.click(await screen.findByRole('button', { name: /^(만들기|Create)$/ }, { timeout: 5000 }));
    await userEvent.click(await screen.findByRole('button', { name: /설치하고 이어가기|Install and continue/ }));
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/AlpineCode\/craft-booking/)).toBeInTheDocument(), { timeout: 10000 });
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
    expect(await screen.findByRole('button', { name: /에이전트:.*·|Agent:.*·/ })).toBeVisible();
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
      <NewSession project={project} clone={clone} onProjectChange={fn()} onNewProject={fn()} onStarted={started} />
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
