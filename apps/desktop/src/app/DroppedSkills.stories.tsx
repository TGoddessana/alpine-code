import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { setUpScript } from '@/shared/server';

import { DroppedSkillsDialog } from './DroppedSkills';

/** What dropping a skill on the window tells: it was added, which of several to add, or why it could not be. */
const meta = {
  title: 'App/DroppedSkills',
  component: DroppedSkillsDialog,
  args: { onClose: fn(), outcome: null },
  parameters: { server: setUpScript() },
} satisfies Meta<typeof DroppedSkillsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Added: Story = { args: { outcome: { kind: 'added', names: ['frontend-design'] } } };

export const SeveralInOneZip: Story = {
  args: {
    outcome: {
      kind: 'choose',
      result: {
        source: '/Users/me/Downloads/team-skills.zip',
        added: [],
        choices: [
          {
            name: 'weekly-report',
            description: '주간 보고서를 쓸 때. 지난주에 바뀐 내용을 정리해 보고서로 만들어요.',
            hasScripts: false,
            installed: true,
          },
          {
            name: 'release-notes',
            description: 'Write release notes from merged pull requests.',
            hasScripts: false,
            installed: false,
          },
          {
            name: 'invoice-pdf',
            description: 'Make a PDF invoice from an order. Use when the user asks for an invoice.',
            hasScripts: true,
            installed: false,
          },
        ],
      },
    },
  },
};

export const NotASkill: Story = {
  args: { outcome: { kind: 'failed', message: '파일이 깨졌거나 스킬 파일이 아니에요' } },
};
