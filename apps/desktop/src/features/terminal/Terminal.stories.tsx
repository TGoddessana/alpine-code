import type { TerminalProcess } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import type { Script } from '@/shared/server';

import { Terminal } from './Terminal';

const process: TerminalProcess = {
  id: 'terminal-1',
  command: 'pnpm test --watch',
  cwd: '/project',
  title: 'pnpm test --watch',
  pty: true,
  pid: 4128,
  status: 'running',
  exitCode: null,
  createdAt: 1,
  outputSize: 0,
  cancelled: false,
};
const text = '\x1b[32mPASS\x1b[0m src/App.test.tsx\r\n한글 로그와 stderr 출력을 보존합니다.\r\nWaiting for input…\r\n';
const server = {
  results: {
    'terminals/list': { processes: [process] },
    'terminals/read': ({ offset = 0 }) => ({
      text: offset ? '' : text,
      nextOffset: new TextEncoder().encode(text).length,
      total: new TextEncoder().encode(text).length,
      process,
    }),
    'terminals/start': ({ command }) => ({ process: { ...process, command, title: command } }),
    'terminals/write': { process },
    'terminals/resize': { process },
  },
} satisfies Script;
const meta = {
  title: 'Workspace/Terminal',
  component: Terminal,
  args: { cwd: '/project' },
  parameters: { server },
  decorators: [
    (Story) => (
      <div className="h-150 max-w-4xl bg-canvas">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Terminal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async () => {
    await expect(await screen.findByLabelText(/터미널 출력|Terminal output/)).toHaveTextContent('PASS');
    await userEvent.type(screen.getByLabelText(/터미널 입력|Terminal input/), 'r');
    await userEvent.click(screen.getByRole('button', { name: /전송|Send/ }));
    await expect(screen.getByLabelText(/터미널 입력|Terminal input/)).toHaveValue('');
  },
};
export const Empty: Story = {
  parameters: { server: { results: { 'terminals/list': { processes: [] } } } satisfies Script },
};
export const ReadFailure: Story = {
  parameters: {
    server: {
      results: {
        ...server.results,
        'terminals/read': () => {
          throw new Error('Process connection unavailable');
        },
      },
    } satisfies Script,
  },
  play: async () => {
    await expect(await screen.findByRole('alert')).toHaveTextContent('Process connection unavailable');
  },
};
export const Finished: Story = {
  parameters: {
    server: {
      results: { ...server.results, 'terminals/list': { processes: [{ ...process, status: 'exited', exitCode: 0 }] } },
    } satisfies Script,
  },
};

export const NewPersistentTerminal: Story = {
  parameters: {
    server: {
      results: (() => {
        let shell: TerminalProcess | null = null;
        let content = '';
        return {
          'terminals/list': () => ({ processes: shell ? [shell] : [] }),
          'terminals/start': ({ command, title }) => {
            shell = { ...process, id: 'shell-1', command, title: title ?? 'Shell' };
            content = '$ ';
            return { process: shell };
          },
          'terminals/read': ({ offset = 0 }) => ({
            text: new TextDecoder().decode(new TextEncoder().encode(content).slice(offset)),
            nextOffset: new TextEncoder().encode(content).length,
            total: new TextEncoder().encode(content).length,
            process: shell ?? process,
          }),
          'terminals/write': ({ data }) => {
            content += data + '/project/src · SESSION_VALUE=kept\n$ ';
            return { process: shell ?? process };
          },
          'terminals/resize': () => ({ process: shell ?? process }),
        } satisfies Script['results'];
      })(),
    } satisfies Script,
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /새 터미널|New terminal/ }));
    const input = await screen.findByLabelText(/터미널 입력|Terminal input/);
    await expect(input).toBeEnabled();
    await userEvent.type(input, 'cd src; export SESSION_VALUE=kept');
    await userEvent.click(screen.getByRole('button', { name: /전송|Send/ }));
    await waitFor(async () => {
      await expect(await screen.findByLabelText(/터미널 출력|Terminal output/)).toHaveTextContent('SESSION_VALUE=kept');
    });
  },
};
