import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, screen, userEvent } from 'storybook/test';

import { cloudScript } from '@/shared/server';

import { UpgradeSheet } from './UpgradeSheet';

/** The sheet as a dialog shows it: Pro, from a realtime web app, Settings or a domain. On the scripted server. */
const meta = {
  title: 'Alpine Cloud/Upgrade',
  component: UpgradeSheet,
  args: { onDone: fn(), onBack: fn() },
  parameters: { layout: 'centered', server: cloudScript({ signedIn: true }) },
  decorators: [
    (Story) => (
      <div className="w-103 rounded-xl border border-line bg-canvas-raised p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpgradeSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Why it is offered now, what Pro gives, and the free week (no card). */
export const FromRealtimeApp: Story = {
  args: { reason: '실시간 웹앱은 Pro에서 만들 수 있어요. 웹앱은 지금처럼 무료로 만들 수 있어요.' },
};

/** The free week was used: only subscribing is left, with the trial's last day in the lead. */
export const TrialRunning: Story = {
  parameters: { server: cloudScript({ signedIn: true, plan: 'trial' }) },
};

/** Paying happens in the browser; the sheet waits and goes on by itself when the plan turns to Pro. */
export const Paying: Story = {
  parameters: { server: cloudScript({ signedIn: true, checkoutMs: 4000 }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^바로 Pro 시작하기$|^Start Pro now$/ }));
  },
};

/** Pro belongs to the Alpine account, so a signed-out person signs in first. */
export const SignedOut: Story = {
  parameters: { server: cloudScript({ signedIn: false }) },
};
