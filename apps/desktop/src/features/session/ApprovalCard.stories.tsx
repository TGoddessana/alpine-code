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
  askedBy: [],
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

const writer = (agent: string, task: string, path: string, line: string) => ({
  agent,
  task,
  callId: `call-${agent}`,
  title: `Create ${path}`,
  preview: `--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`,
  previewKind: 'diff' as const,
  tool: 'write',
  args: { path, content: `${line}\n` },
});

const grouped: ApprovalItem = {
  ...asked,
  title: 'Create site/01-hero.html',
  preview: null,
  previewKind: 'diff',
  reason: null,
  remember: 'file writes in this project',
  tool: 'write',
  args: { path: 'site/01-hero.html' },
  askedBy: [
    writer('a1', '첫 화면 섹션', 'site/01-hero.html', '<h1>동네 빵집</h1>'),
    writer('a2', '메뉴 섹션', 'site/02-menu.html', '<ul><li>소금빵</li></ul>'),
  ],
};

/** Two TF agents write two different files under the same rule: one card, each agent's file and preview under its
 * task, a skip of its own on each line, and the buttons below for all of them. */
export const AgentsWritingDifferentFiles: Story = {
  args: { approval: grouped },
  play: async () => {
    await expect(await screen.findByText(/에이전트 2명이|2 agents are asking/)).toBeVisible();
    await expect(screen.getByTitle('site/02-menu.html')).toBeVisible();
    await expect(screen.getByText('+<ul><li>소금빵</li></ul>')).toBeVisible();
    await expect(screen.getByRole('button', { name: /메뉴 섹션만 건너뛰기|Skip only 메뉴 섹션/ })).toBeVisible();
  },
};

/** Two agents run commands that start the same way but differ after it: each command is shown. */
export const AgentsRunningDifferentCommands: Story = {
  args: {
    approval: {
      ...asked,
      reason: null,
      remember: 'bash commands starting with `python3`',
      askedBy: [
        {
          ...writer('a1', '영수증', '', ''),
          title: 'Run command',
          previewKind: 'command',
          tool: 'bash',
          preview: 'python3 -m pytest tests/test_receipts.py',
          args: { command: 'python3 -m pytest tests/test_receipts.py' },
        },
        {
          ...writer('a2', '재고', '', ''),
          title: 'Run command',
          previewKind: 'command',
          tool: 'bash',
          preview: 'python3 -m pytest tests/test_stock.py',
          args: { command: 'python3 -m pytest tests/test_stock.py' },
        },
      ],
    },
  },
  play: async () => {
    await expect(await screen.findAllByText(/tests\/test_stock\.py/)).not.toHaveLength(0);
    await expect(screen.getAllByText(/tests\/test_receipts\.py/)).not.toHaveLength(0);
  },
};
