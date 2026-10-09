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
 * place to read, change, check, try and delete, and the form for a new one. 스킬, MCP and 서브에이전트 are 준비 중.
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
  },
  parameters: { server: setUpScript() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One tool already on the agent, one that changed outside the app, one that is broken. */
export const List: Story = {};

export const ToolTab: Story = { args: { start: { kind: 'list', tab: 'tool' } } };

export const SkillsSoon: Story = {
  args: { start: { kind: 'list', tab: 'skill' } },
  play: async () => {
    await expect(await screen.findByText('스킬은 준비 중이에요')).toBeVisible();
  },
};

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
