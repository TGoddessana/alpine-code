import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { chatScript, PROJECTS, SESSIONS, sessionInfo } from '@/shared/server';

import { Rail } from './Rail';

/**
 * Board RailProjects: every project on a line, only the current one open (the most recently used, with no address to
 * say otherwise) with its new session, pages and sessions. The rail links need a router, so each story makes one.
 */
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

export const Projects: Story = {
  parameters: { server: { results: { 'projects/list': { projects: PROJECTS, clones: [] } } } },
};

/** The current project's sessions, most recently used first; one is at work. */
export const WithSessions: Story = { parameters: { server: chatScript() } };

/** A closed project says what it is doing only when it is doing something: here a session there waits for my OK. */
export const WaitingElsewhere: Story = {
  parameters: {
    server: chatScript({
      sessions: [
        ...SESSIONS.map((info) => ({ info })),
        { info: sessionInfo({ id: 's-wait', title: '배포 확인', cwd: '/Users/me/docs-site', status: 'waiting' }) },
      ],
    }),
  },
};

/** A wrong address is fixed while the dialog is still open. */
export const GetNotFound: Story = {
  parameters: { server: chatScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(프로젝트 추가|Add a project)$/ }));
    await userEvent.click(await screen.findByRole('button', { name: /회사·팀 프로젝트 받기|Get a team project/ }));
    await userEvent.type(await screen.findByLabelText(/저장소 주소|Repository address/), 'owner/fails');
    await userEvent.click(screen.getByRole('button', { name: /^(받기|Get)$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  },
};

/** A private repository asks for a sign-in in the same dialog. */
export const GetPrivate: Story = {
  parameters: { server: chatScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(프로젝트 추가|Add a project)$/ }));
    await userEvent.click(await screen.findByRole('button', { name: /회사·팀 프로젝트 받기|Get a team project/ }));
    await userEvent.type(await screen.findByLabelText(/저장소 주소|Repository address/), 'acme/private-app');
    await userEvent.click(screen.getByRole('button', { name: /^(받기|Get)$/ }));
    await waitFor(() => expect(screen.getByLabelText(/^(아이디|Username)$/)).toBeVisible());
  },
};

export const NoProjects: Story = {
  parameters: { server: { results: { 'projects/list': { projects: [], clones: [] } } } },
};
