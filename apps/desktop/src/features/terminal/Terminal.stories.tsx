import type { TerminalProcess } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';

import type { Script } from '@/shared/server';
import { editDemoShell } from '@/shared/server/demoTerminal';

import { Terminal } from './Terminal';

const shell = (id: string, title: string): TerminalProcess => ({
  id,
  title,
  command: 'exec /bin/zsh -i',
  kind: 'shell',
  cwd: '/project',
  pty: true,
  pid: 4128 + Number(id.at(-1)),
  status: 'running',
  exitCode: null,
  createdAt: 1,
  outputSize: 0,
  cancelled: false,
});
function demo(empty = false): Script {
  let next = 2;
  const processes = new Map<string, TerminalProcess>(
    empty
      ? []
      : [
          ['shell-1', shell('shell-1', 'zsh')],
          ['shell-2', { ...shell('shell-2', 'pnpm test'), kind: 'command' }],
        ],
  );
  const output = new Map<string, string>([
    ['shell-1', '\x1b[36m\uf07b ~/alpine-code \ue0b0\x1b[0m \x1b[32m\uf126 main \uf120\x1b[0m\r\n╰─❯ '],
    [
      'shell-2',
      '\x1b[36m RUN \x1b[0m v5.0.2 /project\r\n\r\n \x1b[32m✓\x1b[0m src/App.test.tsx (4 tests)\r\n \x1b[32m✓\x1b[0m src/Cart.test.tsx (6 tests)\r\n\r\n Test Files  \x1b[32m2 passed\x1b[0m (2)\r\n      Tests  \x1b[32m10 passed\x1b[0m (10)\r\n\r\n\x1b[2mWaiting for file changes…\x1b[0m\r\n',
    ],
  ]);
  const input = new Map<string, string>();
  return {
    results: {
      'terminals/list': () => ({ processes: [...processes.values()] }),
      'terminals/start': ({ title }) => {
        const id = `shell-${++next}`;
        const process = shell(id, title ?? 'zsh');
        processes.set(id, process);
        output.set(id, '\x1b[36m\uf07b ~/alpine-code \ue0b0\x1b[0m \x1b[32m\uf126 main \uf120\x1b[0m\r\n╰─❯ ');
        return { process };
      },
      'terminals/read': ({ processId, offset = 0 }) => {
        const text = output.get(processId) ?? '';
        const bytes = new TextEncoder().encode(text);
        return {
          process: processes.get(processId)!,
          text: new TextDecoder().decode(bytes.slice(offset)),
          nextOffset: bytes.length,
          total: bytes.length,
        };
      },
      'terminals/write': ({ processId, data }) => {
        const next = editDemoShell(
          { text: output.get(processId) ?? '', line: input.get(processId) ?? '', exitCode: null },
          data,
          '\x1b[32m➜\x1b[0m  \x1b[36malpine-code\x1b[0m ',
        );
        if (next.exitCode !== null) {
          processes.set(processId, { ...processes.get(processId)!, status: 'exited', exitCode: next.exitCode });
        }
        output.set(processId, next.text);
        input.set(processId, next.line);
        return { process: processes.get(processId)! };
      },
      'terminals/resize': ({ processId }) => ({ process: processes.get(processId)! }),
      'terminals/close': ({ processId }) => {
        processes.delete(processId);
        return { closed: true };
      },
    },
  };
}
const meta = {
  title: 'Workspace/Terminal',
  component: Terminal,
  args: { cwd: '/project' },
  parameters: { server: demo() },
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
    await screen.findByRole('textbox', { name: /^(터미널 입력|Terminal input): zsh$/ });
    await expect(await screen.findByRole('textbox', { name: /터미널 입력|Terminal input/ })).toBeInTheDocument();
  },
};
export const Split: Story = {
  play: async () => {
    await screen.findByRole('textbox', { name: /^(터미널 입력|Terminal input): zsh$/ });
    await userEvent.click(await screen.findByRole('button', { name: /터미널 분할|Split terminal/ }));
    await expect(await screen.findAllByRole('textbox', { name: /터미널 입력|Terminal input/ })).toHaveLength(2);
  },
};
export const Empty: Story = { parameters: { server: demo(true) } };
export const NewPersistentTerminal: Story = {
  parameters: { server: demo(true) },
  play: async () => {
    await expect(await screen.findByRole('textbox', { name: /터미널 입력|Terminal input/ })).toBeInTheDocument();
  },
};
export const ReadFailure: Story = {
  parameters: {
    server: {
      results: {
        ...demo().results,
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
  args: { processId: 'shell-2' },
  parameters: {
    server: {
      results: {
        ...demo().results,
        'terminals/list': {
          processes: [{ ...shell('shell-2', 'pnpm test'), kind: 'command', status: 'exited', exitCode: 0 }],
        },
      },
    } satisfies Script,
  },
};

export const Sidebar: Story = {
  parameters: { server: demo(true) },
  play: async () => {
    await screen.findByRole('textbox', { name: /터미널 입력|Terminal input/ });
    await userEvent.click(screen.getByRole('button', { name: /터미널 분할|Split terminal/ }));
    await expect(await screen.findAllByRole('textbox', { name: /터미널 입력|Terminal input/ })).toHaveLength(2);
    await expect(screen.queryByRole('button', { name: /다른 터미널|Other terminals/ })).not.toBeInTheDocument();
  },
  decorators: [
    (Story) => (
      <div className="h-full w-90">
        <Story />
      </div>
    ),
  ],
};

export const PromptGlyphs: Story = {
  parameters: {
    server: {
      results: {
        'terminals/list': { processes: [shell('glyphs', 'zsh')] },
        'terminals/read': ({ offset = 0 }) => {
          const text =
            '\x1b[36m\uf07b ~/alpine-code \ue0b0\x1b[0m \x1b[32m\uf126 main \uf120\x1b[0m\r\n╰─❯ 한글 · \uf013 \u{f0001}\r\n';
          const total = new TextEncoder().encode(text).length;
          return { process: shell('glyphs', 'zsh'), text: offset ? '' : text, nextOffset: total, total };
        },
        'terminals/resize': { process: shell('glyphs', 'zsh') },
      },
    } satisfies Script,
  },
};
