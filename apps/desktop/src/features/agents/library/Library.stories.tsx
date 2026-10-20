import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { setUpScript } from '@/shared/server/fixtures';
import { AGENTS } from '@/shared/server/toolsScript';

import { Library } from './Library';
import type { LibraryView } from './types';

const site = AGENTS.find((a) => a.id === 'a-site')!;

function Example({ start, ...props }: React.ComponentProps<typeof Library> & { start: LibraryView }) {
  const [view, setView] = useState(start);
  return (
    <div className="h-screen w-110">
      <Library {...props} view={view} onViewChange={setView} />
    </div>
  );
}

/**
 * Board 에이전트 화면, the library side: skills to find, add, open and write. MCP and 서브에이전트 are 준비 중.
 */
const meta = {
  title: 'Agents/Library',
  component: Example,
  args: {
    start: { kind: 'list', tab: 'skill' },
    agent: site,
    agents: AGENTS,
    view: { kind: 'list', tab: 'skill' },
    onViewChange: fn(),
    skillActions: { onToggle: fn(), onInstalled: fn() },
  },
  parameters: { server: setUpScript() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/** My skills (one from Claude Code), then the recommended ones, each added with one press. */
export const Skills: Story = {};

/** A recommended skill: one press fetches and installs it, and the screen is told. */
export const AddingARecommendedSkill: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'PDF 다루기 추가' }));
    await waitFor(() => expect(args.skillActions.onInstalled).toHaveBeenCalledWith(['pdf'], ['pdf'], 'PDF 다루기'));
  },
};

/** Words search skills.sh; the most installed come first. */
export const SearchingSkills: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole('textbox'), 'pdf');
    await expect(await screen.findByText('anthropics/skills · 설치 21만')).toBeVisible();
  },
};

/** A link to a repository with several skills asks which ones to add. */
export const LinkWithSeveralSkills: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole('textbox'), 'https://github.com/anthropics/skills{Enter}');
    await expect(await screen.findByText('anthropics/skills에 스킬이 7개 있어요')).toBeVisible();
  },
};

/** A skill written in Alpine, opened: who uses it, its SKILL.md, and edit and delete. */
export const SkillDetail: Story = { args: { start: { kind: 'skill', name: 'weekly-report' } } };

/** Another app's skill reads the same, but stays where it is: no edit, no delete. */
export const OtherAppsSkill: Story = { args: { start: { kind: 'skill', name: 'commit-messages' } } };

export const NewSkill: Story = { args: { start: { kind: 'new-skill' } } };

/** MCP is 준비 중. */
export const Mcp: Story = { args: { start: { kind: 'list', tab: 'mcp' } } };
