import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { chatScript, PROJECTS, SESSIONS, sessionInfo, mergeScripts, statefulScript, CONNECTED } from '@/shared/server';

import { Rail } from './Rail';
import { NavigationController } from './NavigationController';

/**
 * Independent project browsing, important work, and archive states.
 */
const meta = {
  title: 'Rail/Rail',
  component: Rail,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({
          component: () => (
            <div className="flex h-screen">
              {Story()}
              <NavigationController />
            </div>
          ),
        }),
      });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Projects: Story = {
  parameters: { server: chatScript({ sessions: [] }) },
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

/** Twenty projects and two hundred sessions: old approvals, pinned work and results must stay discoverable. */
const scaleProjects = Array.from({ length: 20 }, (_, i) => ({
  ...PROJECTS[0]!,
  name: `project-${String(i + 1).padStart(2, '0')}`,
  path: `/Users/me/project-${i + 1}`,
}));
export const ManyProjects: Story = {
  parameters: {
    server: mergeScripts(
      chatScript({
        sessions: scaleProjects.flatMap((project, i) =>
          Array.from({ length: 10 }, (_, j) => ({
            info: sessionInfo({
              id: `scale-${i}-${j}`,
              cwd: project.path,
              title: `Checkout accessibility review ${j + 1}`,
              updatedAt: new Date(Date.now() - j * 3_600_000).toISOString(),
              pinned: j === 8,
              status: j === 9 ? 'waiting' : j === 7 ? 'failed' : 'idle',
              summary: 'Updated the checkout form and checked the keyboard navigation.',
            }),
          })),
        ),
      }),
      statefulScript({ connections: CONNECTED, projects: scaleProjects }),
    ),
  },
};

export const ArchivedWork: Story = {
  parameters: {
    server: mergeScripts(
      chatScript({
        sessions: [
          {
            info: sessionInfo({
              id: 'archived-1',
              title: '지난 배포 확인',
              archived: true,
              summary: 'The deployment checks passed.',
            }),
          },
        ],
      }),
      statefulScript({ connections: CONNECTED, projects: PROJECTS.map((p, i) => ({ ...p, archived: i === 1 })) }),
    ),
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(보관함|Archive)$/ }));
  },
};
