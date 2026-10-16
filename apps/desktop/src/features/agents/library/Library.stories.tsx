import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { setUpScript } from '@/shared/server/fixtures';
import { AGENTS } from '@/shared/server/toolsScript';

import { Library } from './Library';
import type { LibraryView } from './types';

const [, site, review] = AGENTS as [(typeof AGENTS)[number], (typeof AGENTS)[number], (typeof AGENTS)[number]];

function Example({ start, ...props }: React.ComponentProps<typeof Library> & { start: LibraryView }) {
  const [view, setView] = useState(start);
  return (
    <div className="h-screen w-110">
      <Library {...props} view={view} onViewChange={setView} />
    </div>
  );
}

/**
 * Board 에이전트 화면, the library side: the user's tools as cards the agent on the left can take, a tool opened in
 * place to read, change, check, try and delete, and the form for a new one; skills to find, add, open and write.
 * MCP and 서브에이전트 are 준비 중.
 */
const meta = {
  title: 'Agents/Library',
  component: Example,
  args: {
    start: { kind: 'list', tab: 'all' },
    agent: site,
    agents: AGENTS,
    view: { kind: 'list', tab: 'all' },
    onViewChange: fn(),
    onAdd: fn(),
    onRemove: fn(),
    onCreated: fn(),
    onDragChange: fn(),
    skillActions: { onToggle: fn(), onInstalled: fn() },
  },
  parameters: { server: setUpScript() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One tool already on the agent, one that changed outside the app, one that is broken. */
export const List: Story = {};

export const ToolTab: Story = { args: { start: { kind: 'list', tab: 'tool' } } };

/** My skills (one from Claude Code), then the recommended ones, each added with one press. */
export const Skills: Story = { args: { start: { kind: 'list', tab: 'skill' } } };

/** A recommended skill: one press fetches and installs it, and the screen is told. */
export const AddingARecommendedSkill: Story = {
  args: { start: { kind: 'list', tab: 'skill' } },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'PDF 다루기 추가' }));
    await waitFor(() => expect(args.skillActions.onInstalled).toHaveBeenCalledWith(['pdf'], ['pdf'], 'PDF 다루기'));
  },
};

/** Words search skills.sh; the most installed come first. */
export const SearchingSkills: Story = {
  args: { start: { kind: 'list', tab: 'skill' } },
  play: async () => {
    await userEvent.type(await screen.findByRole('textbox'), 'pdf');
    await expect(await screen.findByText('anthropics/skills · 설치 21만')).toBeVisible();
  },
};

/** A link to a repository with several skills asks which ones to add. */
export const LinkWithSeveralSkills: Story = {
  args: { start: { kind: 'list', tab: 'skill' } },
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

/** Code, check, save (with the 저장했어요 line), try it and delete, against the scripted server. */
export const ToolDetail: Story = {
  args: { start: { kind: 'tool', file: 'fetch', tool: 'fetch' } },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('저장했어요'));
  },
};

/** Changed outside the app: a banner asks to read it and turn it on; it cannot be added before that. */
export const Unconfirmed: Story = {
  args: { start: { kind: 'tool', file: 'order_stats', tool: 'order_stats' } },
};

export const NewTool: Story = { args: { start: { kind: 'new-tool' } } };

/** An agent without the tool: '+ 추가' reports it and adds nothing itself. */
export const AddingATool: Story = {
  args: { agent: review },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: /\+ 추가|\+ Add/ }));
    await expect(args.onAdd).toHaveBeenCalledWith(['fetch'], 'fetch');
  },
};
