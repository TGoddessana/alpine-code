import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';

import { PROJECTS } from '@/shared/server';

import { Rail } from './Rail';

/** Board RailProjects: with projects, and with none. The rail links need a router, so each story makes one. */
const meta = {
  title: 'Rail/Rail',
  component: Rail,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({ component: () => <div className="flex h-screen">{Story()}</div> }),
      });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Projects: Story = { parameters: { server: { results: { 'projects/list': { projects: PROJECTS } } } } };

export const NoProjects: Story = { parameters: { server: { results: { 'projects/list': { projects: [] } } } } };
