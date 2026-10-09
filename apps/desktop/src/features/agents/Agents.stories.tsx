import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { chatScript } from '@/shared/server';

import { Agents } from './Agents';

function Example({ start, creating = false }: { start?: string; creating?: boolean }) {
  const [search, setSearch] = useState<{ agent?: string; create?: true }>({
    ...(start ? { agent: start } : {}),
    ...(creating ? { create: true as const } : {}),
  });
  return (
    <main className="flex h-screen min-w-120 grow flex-col overflow-hidden bg-canvas">
      <Agents agentId={search.agent} creating={!!search.create} onChange={setSearch} />
    </main>
  );
}

/**
 * Boards 에이전트 화면 and 새 에이전트: the agents along the top, the one being edited on the left and the library on
 * the right. The server is scripted with three agents, the user's tools and a session at work on 홈페이지 담당.
 */
const meta = {
  title: 'Agents/Agents',
  component: Example,
  parameters: { layout: 'fullscreen', server: chatScript() },
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({ component: () => <div className="flex h-screen">{Story()}</div> }),
      });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 홈페이지 담당 with the ● 지금 일하는 중 line, because one of its sessions is running. */
export const Default: Story = {
  args: { start: 'a-site' },
  play: async () => {
    await expect(await screen.findByRole('heading', { name: '홈페이지 담당' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((s) => /지금 일하는 중/.test(s.textContent ?? ''))).toBe(true),
    );
  },
};

/** The agent nobody renamed reads as 기본 에이전트, and cannot be deleted. */
export const DefaultAgent: Story = {
  play: async () => {
    await expect(await screen.findByRole('heading', { name: /기본 에이전트|Default agent/ })).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: /에이전트 메뉴|Agent menu/ }));
    await expect(await screen.findByRole('menuitem', { name: /지우기|Delete/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};

/** A reviewer reads but cannot change: three built-in tools on, three off with 다시 추가. */
export const ReadOnlyReviewer: Story = { args: { start: 'a-review' } };

/** 새 에이전트: four starting points, the name, the model, and a way to copy one that exists. */
export const NewAgent: Story = {
  args: { start: 'a-site', creating: true },
  play: async () => {
    await expect(await screen.findByRole('radio', { name: /검토하는 사람/ })).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: /검토하는 사람/ }));
    await expect(screen.getByRole('radio', { name: /검토하는 사람/ })).toHaveAttribute('aria-checked', 'true');
  },
};

/** Clicking the big character opens the twelve looks and eight colours; a pick saves at once. */
export const CharacterPicker: Story = {
  args: { start: 'a-site' },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /캐릭터 바꾸기|Change character/ }));
    const glasses = await screen.findByRole('button', { name: /^(안경|Glasses)$/ });
    await userEvent.click(glasses);
    await waitFor(() => expect(glasses).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** Taking a tool off saves at once and says so, with a way back. */
export const RemoveTool: Story = {
  args: { start: 'a-site' },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /파일 읽기 빼기|Remove 파일 읽기/ }));
    await expect(await screen.findByText(/파일 읽기를 홈페이지 담당에서 뺐어요|Removed 파일 읽기/)).toBeVisible();
    await expect(screen.getByRole('button', { name: /되돌리기|Undo/ })).toBeVisible();
  },
};
