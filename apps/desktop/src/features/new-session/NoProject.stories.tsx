import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';

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

/** Three ways in: 새로 만들기 first, then getting a repository, then a folder already here. */
export const Empty: Story = {
  play: async () => {
    const section = await screen.findByRole('region', { name: /어떤 프로젝트로 시작할까요\?|Which project/ });
    expect(section.querySelectorAll('button')).toHaveLength(3);
    expect(section.querySelector('button')).toHaveTextContent(/새로 만들기|Make a new project/);
  },
};
