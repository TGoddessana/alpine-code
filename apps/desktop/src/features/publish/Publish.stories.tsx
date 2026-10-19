import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { cloudScript } from '@/shared/server';

import { PublishButton } from './PublishButton';
import { PublishOffer } from './PublishOffer';
import type { Scenario } from './preview';

const PROJECT = { name: 'craft-booking', changes: 3, lastPublished: new Date(Date.now() - 2 * 60 * 60 * 1000) };

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

function Example({
  scenario,
  signedIn = true,
  open = true,
}: {
  scenario: Scenario;
  signedIn?: boolean;
  open?: boolean;
}) {
  return (
    <TopBar>
      <PublishButton project={PROJECT} scenario={scenario} signedIn={signedIn} defaultOpen={open} onFix={fn()} />
    </TopBar>
  );
}

/** docs/alpine-cloud.md decisions 14, 15, 17 and 23. Checks and publishing run on stand-ins until Alpine Cloud exists. */
const meta = {
  title: 'Alpine Cloud/Publish',
  component: Example,
  args: { scenario: 'clean' },
  parameters: { layout: 'fullscreen', server: cloudScript({ signedIn: true }) },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The top bar's button with a dot: there are changes not online yet. */
export const Button: Story = { args: { open: false } };

/** Every check settles fine; 올리기 runs, then the address and its QR code. */
export const CleanToPublished: Story = {
  play: async () => {
    const publish = await screen.findByRole('button', { name: /^올리기$|^Publish$/ });
    await waitFor(() => expect(publish).toBeEnabled(), { timeout: 5000 });
    await userEvent.click(publish);
    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeVisible(), { timeout: 6000 });
  },
};

/** One finding to look at, in plain words, with the AI to fix it. Publishing is still allowed (decision 17). */
export const Finding: Story = { args: { scenario: 'warning' } };

/** A secret key in the page code: the one thing that blocks. */
export const SecretKeyBlocks: Story = { args: { scenario: 'secret' } };

/** A column goes away: asked separately before 올리기 opens (decision 15). */
export const ColumnRemoved: Story = { args: { scenario: 'drop' } };

/** Own AI only, never signed in: the account is asked for with its reason, then the checks run (decision 23). */
export const SignedOut: Story = {
  args: { signedIn: false },
  parameters: { server: cloudScript({ signInMs: 800 }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Google로 계속하기|Continue with Google/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^올리기$|^Publish$/ })).toBeVisible(), {
      timeout: 5000,
    });
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
