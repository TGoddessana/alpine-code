import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { publishServer } from '@/shared/server';

import { PublishButton } from './PublishButton';
import { PublishOffer } from './PublishOffer';

/** The window's top bar with the project on the left, as the app shows it, and the page under it. */
function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-canvas-sunken">
      <div className="flex h-11.5 shrink-0 items-center gap-2 pr-3 pl-20">
        <span className="text-body text-fg">craft-booking</span>
        <span className="text-meta text-fg-muted">main</span>
        <span className="grow" />
        {children}
      </div>
      <div className="mx-2 mb-2 grow rounded-xl border border-line bg-canvas" />
    </div>
  );
}

function Example({ open = true }: { open?: boolean }) {
  return (
    <TopBar>
      <PublishButton cwd="/project" name="craft-booking" sessionId="session-1" defaultOpen={open} onEvidence={fn()} />
    </TopBar>
  );
}

/** The sheet is the real one, on `publish/*` of the scripted server (docs/alpine-cloud-api.md 6.2). */
const meta = {
  title: 'Alpine Cloud/Publish',
  component: Example,
  parameters: { layout: 'fullscreen', server: publishServer() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

const publishButton = () => screen.findByRole('button', { name: /^올리기$|^Publish$/ }, { timeout: 8000 });

/** The top bar's button with a dot: there are changes not online yet. */
export const Button: Story = { args: { open: false } };

/** Every check settles fine; 올리기 runs, then the address and its QR code. */
export const CleanToPublished: Story = {
  play: async () => {
    const publish = await publishButton();
    await waitFor(() => expect(publish).toBeEnabled(), { timeout: 8000 });
    await userEvent.click(publish);
    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeVisible(), { timeout: 8000 });
  },
};

/** One finding to look at, in plain words, with the AI to fix it. Publishing is still allowed (decision 17). */
export const Finding: Story = {
  parameters: { server: publishServer({ publish: 'warning' }) },
  play: async () => {
    await screen.findByText(/로그인하지 않아도 데이터를 보여줘요|not signed in/, undefined, { timeout: 8000 });
  },
};

/** A finding the app has no sentence for shows the server's own sentence. */
export const UnknownFinding: Story = {
  parameters: { server: publishServer({ publish: 'advisor' }) },
};

/** A secret key in the page code: the one thing that blocks. The button asks the AI to fix it. */
export const SecretKeyBlocks: Story = {
  parameters: { server: publishServer({ publish: 'blocked' }) },
  play: async () => {
    await screen.findByRole('button', { name: /AI에게 고쳐 달라고 하기|Ask the AI to fix it/ }, { timeout: 8000 });
  },
};

/** A column goes away: asked separately, and 올리기 stays off until it is said OK (decision 15). */
export const ColumnRemoved: Story = {
  parameters: { server: publishServer({ publish: 'drop' }) },
  play: async () => {
    const publish = await publishButton();
    await screen.findByText(/memo/, undefined, { timeout: 8000 });
    await expect(publish).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(publish).toBeEnabled());
  },
};

/** Every kind of change that asks: drop, rename, data change, and a statement nobody understood. */
export const ManyConfirms: Story = {
  parameters: { server: publishServer({ publish: 'confirms' }) },
};

/** The build stopped: the last lines are shown and the AI can be asked to fix it. */
export const BuildFailure: Story = {
  parameters: { server: publishServer({ publish: 'build_failed' }) },
  play: async () => {
    await screen.findByText(/앱을 만들다가 멈췄어요|Building the app stopped/, undefined, { timeout: 8000 });
  },
};

/** The database change failed while publishing: the old version stays online. */
export const PublishFailure: Story = {
  parameters: { server: publishServer({ publish: 'run_failed' }) },
  play: async () => {
    const publish = await publishButton();
    await waitFor(() => expect(publish).toBeEnabled(), { timeout: 8000 });
    await userEvent.click(publish);
    await screen.findByText(/올리다가 멈췄어요|Publishing stopped/, undefined, { timeout: 8000 });
  },
};

/** Not signed in: the account is asked for with its reason, then the checks run (decision 23). */
export const SignedOut: Story = {
  parameters: { server: publishServer({ signedIn: false, signInMs: 800 }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Google로 계속하기|Continue with Google/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^올리기$|^Publish$/ })).toBeVisible(), {
      timeout: 8000,
    });
  },
};

/** No Node.js on this computer: Alpine offers its own copy. */
export const NoNode: Story = {
  parameters: { server: publishServer({ node: 'missing' }) },
};

/** The restore points: data and code go back together. */
export const Restore: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^되돌리기$|^Restore$/ }, { timeout: 8000 }));
    const group = await screen.findByRole('radiogroup');
    await userEvent.click(within(group).getAllByRole('radio')[1]!);
    await userEvent.click(screen.getByRole('button', { name: /이 때로 되돌리기|Go back to this point/ }));
    await screen.findByRole('status', undefined, { timeout: 8000 });
  },
};

function Conversation() {
  const [answered, setAnswered] = useState<'publish' | 'later' | null>(null);
  return (
    <div className="flex h-screen justify-center overflow-y-auto bg-canvas">
      <div className="flex w-full max-w-175 flex-col gap-5 px-6 py-10">
        <div className="self-end rounded-2xl bg-hover px-4 py-2.5 text-reading">
          자리가 차면 대기 명단에 올려 주는 것까지 해 줘
        </div>
        <p className="text-reading text-fg">
          대기 명단 표를 만들고, 수업 정원이 차면 예약 버튼이 &ldquo;대기 명단에 올리기&rdquo;로 바뀌게 했어요. 자리가
          나면 맨 앞 사람에게 메일이 가요.
        </p>
        <p className="text-meta text-fg-muted">명령 3개 실행 · 파일 4개 바꿈 · 화면 2번 봄 ›</p>
        {answered === null ? (
          <PublishOffer
            evidence={2}
            onPublish={() => setAnswered('publish')}
            onLater={() => setAnswered('later')}
            onEvidence={fn()}
          />
        ) : (
          <p className="motion-step text-meta text-fg-muted">
            {answered === 'publish' ? '올리기 창을 열었어요' : '나중에 올려요'}
          </p>
        )}
      </div>
    </div>
  );
}

/** When the AI is done it offers to publish in the conversation (decision 14). */
export const OfferInConversation: StoryObj = {
  render: () => <Conversation />,
};
