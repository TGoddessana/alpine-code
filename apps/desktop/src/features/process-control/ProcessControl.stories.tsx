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
  title: '프로덕션 빌드',
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
      'processes/list': () => ({ processes: [current] }),
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
        return { processes: [current] };
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
export const StopAll: Story = {
  parameters: { server: script() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /전체 중단|Stop all/ }));
    await expect(await screen.findByText(/종료 대기 · 아직 실행 중|Waiting for exit · still running/)).toBeVisible();
  },
};
export const Empty: Story = {
  parameters: { server: { results: { 'processes/list': { processes: [] } } } satisfies Script },
};

export const AgentCommands: Story = {
  parameters: {
    server: {
      results: {
        'processes/list': {
          processes: [
            { ...process, id: 'types', title: '타입 검사', command: 'pnpm typecheck', createdAt: 3 },
            {
              ...process,
              id: 'tests',
              title: '단위 테스트 실행',
              command: 'pnpm test',
              status: 'exited',
              exitCode: 0,
              createdAt: 2,
            },
            {
              ...process,
              id: 'lint',
              title: '코드 스타일 검사',
              command: 'pnpm lint',
              status: 'failed',
              exitCode: 1,
              createdAt: 1,
            },
          ],
        },
      },
    } satisfies Script,
  },
};
