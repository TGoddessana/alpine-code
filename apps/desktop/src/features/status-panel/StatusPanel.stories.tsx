import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, within } from 'storybook/test';

import { JUDGED_PLAN, MONOREPO_PLAN, sessionInfo, WORK_PLAN } from '@/shared/server';

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

/**
 * Board Task2Work: one step done, one under way (the ● with the session's word beside it), three to go; the checks
 * not run yet, with who judges each on the right (nothing for the harness, 에이전트, 나). The tabs count 1/5 and 0/3.
 */
export const PlanAndChecks: Story = {
  args: { info: sessionInfo({ status: 'running', plan: WORK_PLAN }) },
  play: async () => {
    await expect(await screen.findByRole('tab', { name: /계획 1\/5|Plan 1\/5/ })).toBeVisible();
    await expect(screen.getByRole('tab', { name: /검증 0\/3|Verification 0\/3/ })).toBeVisible();
    await expect(within(screen.getByRole('tabpanel')).getByText(/작업 중|Working/)).toBeVisible();
  },
};

/**
 * Board StressMonorepo: two packages' checks passed, the third did not run; a step the agent left out of the plan
 * shows under out of the ordinary.
 */
export const ChecksAndADroppedStep: Story = {
  args: { info: sessionInfo({ plan: MONOREPO_PLAN }) },
  play: async () => {
    // Every tab's panel is drawn; only the one shown is a tabpanel to a reader.
    const shown = within(await screen.findByRole('tabpanel'));
    await expect(shown.getByText(/테스트 · web · 통과|테스트 · web · passed/)).toBeVisible();
    await expect(shown.getByText(/테스트 · api · 안 돌림|테스트 · api · not run/)).toBeVisible();
    await expect(shown.getByText(/계획에서 뺀 단계 · e2e|Step dropped from the plan · e2e/)).toBeVisible();
  },
};

/**
 * The verification tab alone: a fact (passed, failed in red), the agent's judgement with how many calls it cited,
 * a check that changed since it passed (kept for when snapshots exist), and one I check by hand.
 */
export const VerificationTab: Story = {
  args: { info: sessionInfo({ status: 'waiting', plan: JUDGED_PLAN }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /검증|Verification/ }));
    const shown = within(await screen.findByRole('tabpanel', { name: /검증|Verification/ }));
    await expect(shown.getByText(/에이전트 · 근거 3|Agent · 3 as evidence/)).toBeVisible();
  },
};
