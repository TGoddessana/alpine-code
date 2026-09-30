import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { useState } from 'react';

import { PROJECTS, setUpScript } from '@/shared/server';

import { NewSession } from './NewSession';

function Example() {
  const [path, setPath] = useState(PROJECTS[0]!.path);
  const project = PROJECTS.find((p) => p.path === path) ?? PROJECTS[0]!;
  return (
    <div className="flex h-screen">
      <NewSession projects={PROJECTS} project={project} onProjectChange={setPath} />
    </div>
  );
}

/** Boards NewSession and ProjectAdd, without the rail and the right panel. */
const meta = {
  title: 'New session/New session',
  component: Example,
  parameters: { server: setUpScript(), layout: 'fullscreen' },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const PickingAProject: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /alpine-code/ }));
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /docs-site/ })).toBeVisible());
  },
};

export const CloneFailed: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /alpine-code/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /복제|Clone/ }));
    await userEvent.type(await screen.findByLabelText(/저장소 주소|Repository address/), 'owner/fails');
    await userEvent.click(screen.getByRole('button', { name: /^(복제|Clone)$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  },
};
