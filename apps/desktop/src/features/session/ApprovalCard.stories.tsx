import type { ApprovalItem } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';

import { setUpScript } from '@/shared/server';

import { ApprovalCard } from './ApprovalCard';

const asked: ApprovalItem = {
  id: 'r1',
  kind: 'approval',
  callId: 'c1',
  title: 'Run command',
  preview: 'rm -rf ~/projects/old-site',
  previewKind: 'command',
  reason: 'touches paths outside the working directory: ~/projects/old-site',
  remember: null,
  decision: null,
  feedback: null,
  tool: 'bash',
  args: { command: 'rm -rf ~/projects/old-site' },
  review: null,
  reviewError: null,
};

const meta = {
  title: 'Session/ApprovalCard',
  component: ApprovalCard,
  args: { sessionId: 's-story', approval: asked },
  parameters: { server: setUpScript() },
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Auto mode blocked three calls in a row, so the user decides the next one. */
export const AfterThreeBlocks: Story = {
  args: { approval: { ...asked, review: 'blocked_in_a_row' } },
  play: async () => {
    await expect(await screen.findByText(/3번 연달아 막아서|3 actions in a row/)).toBeVisible();
  },
};

/** The reviewer could not answer (here a free model's rate limit), so the user is asked, with what went wrong. */
export const ReviewerFailed: Story = {
  args: { approval: { ...asked, review: 'failed', reviewError: '429 Too Many Requests' } },
  play: async () => {
    await expect(await screen.findByText(/확인 AI가 답하지 못해서|couldn't answer/)).toBeVisible();
    await expect(screen.getByText(/429 Too Many Requests/)).toBeVisible();
  },
};
