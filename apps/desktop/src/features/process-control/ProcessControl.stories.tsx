import type { TerminalProcess } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import type { Script } from '@/shared/server';

import { ProcessControl } from './ProcessControl';

const process: TerminalProcess = {
  id: 'build',
  command: 'pnpm build',
  cwd: '/project',
  sessionId: 'chat',
  title: 'pnpm build',
  pty: false,
  pid: 4200,
  status: 'running',
  exitCode: null,
  cancelled: false,
  createdAt: 1,
  outputSize: 200,
};
function script(): Script {
  let current = { ...process };
  return {
    results: {
      'processes/list': () => ({ processes: [current], tools: [] }),
      'terminals/stop': ({ force }) => {
        current = {
          ...current,
          status: force ? 'cancelled' : 'stopping',
          cancelled: true,
          exitCode: force ? -9 : null,
        };
        return { process: current };
      },
      'session/cancel': {},
      'processes/stop': () => {
        current = { ...current, status: 'stopping', cancelled: true };
        return { processes: [current], tools: [] };
      },
    },
  };
}
const meta = {
  title: 'Workspace/Process control',
  component: ProcessControl,
  args: { cwd: '/project', sessionId: 'chat' },
  parameters: { server: script() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl bg-canvas p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProcessControl>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StopAndForce: Story = {
  parameters: { server: script() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^(중단|Stop)$/ }));
    await expect(await screen.findByText(/종료 대기 · 아직 실행 중|Waiting for exit · still running/)).toBeVisible();
    const force = await screen.findByRole('button', { name: /강제 종료|Force stop/ });
    await waitFor(() => expect(force).toBeEnabled());
    await userEvent.click(force);
    await expect(await screen.findByText(/^(중단됨|Stopped)$/)).toBeVisible();
  },
};
export const ResidualUserTool: Story = {
  parameters: {
    server: {
      results: {
        'processes/list': {
          processes: [{ ...process, status: 'cancelled', exitCode: -15, cancelled: true }],
          tools: [
            {
              id: 'worker',
              sessionId: 'chat',
              name: 'slow_export',
              createdAt: 1,
              status: 'stopping',
              cancellable: false,
            },
          ],
        },
      },
    } satisfies Script,
  },
};
export const StopAll: Story = {
  parameters: { server: script() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /전체 중단|Stop all/ }));
    await expect(await screen.findByText(/종료 대기 · 아직 실행 중|Waiting for exit · still running/)).toBeVisible();
  },
};
export const Empty: Story = {
  parameters: { server: { results: { 'processes/list': { processes: [], tools: [] } } } satisfies Script },
};
