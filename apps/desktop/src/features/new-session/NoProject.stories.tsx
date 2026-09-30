import type { Meta, StoryObj } from '@storybook/react-vite';

import { firstRunScript } from '@/shared/server';

import { NoProject } from './NoProject';

/** Board NoProject, without the rail and the right panel. */
const meta = {
  title: 'New session/No project',
  component: NoProject,
  parameters: { server: firstRunScript(), layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen">{Story()}</div>],
} satisfies Meta<typeof NoProject>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
