import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { useState } from 'react';

import { chatScript, PROJECTS, withRouterScript } from '@/shared/server';

import { NewSession } from './NewSession';

const started = fn();

function Example() {
  const [path, setPath] = useState(PROJECTS[0]!.path);
  const project = PROJECTS.find((p) => p.path === path) ?? PROJECTS[0]!;
  return (
    <div className="flex h-screen">
      <NewSession projects={PROJECTS} project={project} onProjectChange={setPath} onStarted={started} />
    </div>
  );
}

/** Boards NewSession and ProjectAdd, without the rail and the right panel. */
const meta = {
  title: 'New session/New session',
  component: Example,
  parameters: { server: chatScript(), layout: 'fullscreen' },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

/** The model picker with a router of 320 models: folded until opened, found by searching. */
export const ManyModels: Story = {
  parameters: { server: withRouterScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('combobox', { name: /새 세션 모델|New session model/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /모델 320개 모두 보기|Show all 320/ })).toBeVisible(),
    );
    await userEvent.type(screen.getByRole('combobox', { name: /모델 찾기|Find a model/ }), 'qwen/model-3');
    await waitFor(() => expect(screen.getByRole('option', { name: 'qwen/model-3' })).toBeVisible());
  },
};

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

/** Sending makes the session and the message, then hands over the new session's id. */
export const Sent: Story = {
  play: async () => {
    await userEvent.type(await screen.findByLabelText(/^(메시지|Message)$/), '안녕하세요{Enter}');
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.stringMatching(/^s-/)));
  },
};
