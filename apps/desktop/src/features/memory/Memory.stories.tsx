import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { expect, screen, userEvent } from 'storybook/test';

import { setUpScript } from '@/shared/server';

import { Memory } from './Memory';

/** The memory page of a project, opened from the project's menu in the rail. Each story has its own server state. */
const meta = {
  title: 'Memory/Memory',
  component: Memory,
  args: { project: '/Users/me/alpine-code' },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({
          component: () => <main className="flex h-screen overflow-y-auto bg-canvas">{Story()}</main>,
        }),
      });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof Memory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A suggestion waiting, then what is kept by scope; one memory was said again after I allowed it. */
export const Learned: Story = {
  parameters: { server: setUpScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /커밋 전에|pnpm lint/ }));
    await expect(await screen.findByText(/CI가 lint 단계에서/)).toBeVisible();
    await expect(screen.getByText(/린트!/)).toBeVisible();
  },
};

/** Keeping the waiting suggestion moves it into team memory. */
export const KeepASuggestion: Story = {
  parameters: { server: setUpScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(기억하기|Remember)$/ }));
    await expect(await screen.findByRole('button', { name: /화면 문구는 해요체로 쓴다/ })).toBeVisible();
  },
};

/** Removing asks once more, in place. */
export const Remove: Story = {
  parameters: { server: setUpScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /배포는 Vercel/ }));
    await userEvent.click(screen.getByRole('button', { name: /^(지우기|Remove)$/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^(지우기|Remove)$/ }));
    await expect(screen.queryByRole('button', { name: /배포는 Vercel/ })).toBeNull();
  },
};

/** A project with nothing learned yet. */
export const Nothing: Story = { args: { project: '/Users/me/docs-site' }, parameters: { server: setUpScript() } };

/** Opened without a project. */
export const NoProject: Story = { args: { project: null }, parameters: { server: setUpScript() } };
