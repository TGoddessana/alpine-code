import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { sessionInfo } from '@/shared/server';

import { StatusPanel } from './StatusPanel';

const used = {
  inputTokens: 18_400,
  outputTokens: 2_150,
  cacheReadTokens: 96_000,
  cacheWriteTokens: 5_300,
  requests: 9,
  cost: 0.12,
};

/** The right panel on its own, next to an empty canvas. */
const meta = {
  title: 'Status panel/StatusPanel',
  component: StatusPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen justify-end bg-canvas">{Story()}</div>],
} satisfies Meta<typeof StatusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoSession: Story = {};

/** The usage part at the bottom of "All": the whole chat's numbers, a quiet line for each, and the memory. */
export const Usage: Story = {
  args: { info: sessionInfo({ usage: used, contextUsed: 45_000, contextWindow: 131_072 }) },
  play: async () => {
    await expect(await screen.findByText('45,000 / 131,072', { exact: false })).toBeVisible();
  },
};

/** While a run is active this run's numbers sit beside the whole chat's. */
export const UsageWhileRunning: Story = {
  args: {
    info: sessionInfo({
      status: 'running',
      usage: used,
      runUsage: {
        inputTokens: 2_300,
        outputTokens: 240,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 800,
        requests: 2,
        cost: 0.02,
      },
      contextUsed: 110_000,
      contextWindow: 131_072,
    }),
  },
};

/** The usage tab alone, and the price when the model's is unknown. */
export const UsageTabNoPrice: Story = {
  args: { info: sessionInfo({ usage: { ...used, cost: null } }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /사용량|Usage/ }));
    await expect(await screen.findByText(/가격 정보 없음|No price info/)).toBeVisible();
  },
};
