import type { TerminalProcess, DevServerInfo } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';
import { useEffect } from 'react';

import { showDockTab } from '@/features/dock/state';
import { WorkResult } from '@/features/work-result/WorkResult';
import { SessionChanges as CheckpointChanges } from '@/features/work-result/SessionChanges';
import { useMessages } from '@/shared/i18n';
import { sessionInfo, type Script } from '@/shared/server';
import { editDemoShell } from '@/shared/server/demoTerminal';

import { WorkspaceDock } from './WorkspaceDock';

const result = {
  files: [
    {
      path: 'src/components/MenuCard.tsx',
      added: 2,
      removed: 1,
      diff: [
        '@@ -18,2 +18,3 @@',
        '   <h3>{menu.name}</h3>',
        '-  <AddToCart />',
        '+  <AddToCart disabled={menu.stock === 0} />',
        '+  {menu.stock === 0 && <span>품절</span>}',
      ],
    },
    {
      path: 'src/data/menu.ts',
      added: 1,
      removed: 1,
      diff: ['@@ -1 +1 @@', '-export const stock = 10;', '+export const stock = 0;'],
    },
    { path: 'public/menu.png', added: 0, removed: 0, diff: null },
  ],
  commands: [{ id: 'test', command: 'pnpm test', status: 'done' as const }],
};

function ReviewWorkspace({
  checkpoints = false,
  initialTab = 'work-result',
}: {
  checkpoints?: boolean;
  initialTab?: string;
}) {
  useEffect(() => {
    showDockTab(initialTab);
  }, [initialTab]);
  const t = useMessages({ ko: { changes: '변경 사항' }, en: { changes: 'Changes' } });
  return (
    <div className="flex h-screen bg-canvas">
      <WorkspaceDock
        cwd="/project"
        sessionId="review"
        scope="review-story"
        tabs={[
          {
            id: 'work-result',
            label: t.changes,
            keepMounted: true,
            content: checkpoints ? (
              <CheckpointChanges sessionId="review" result={result} />
            ) : (
              <WorkResult result={result} />
            ),
          },
        ]}
      >
        <div />
      </WorkspaceDock>
    </div>
  );
}
const meta = {
  title: 'Workspace/Changes review',
  component: ReviewWorkspace,
  parameters: {
    server: {
      results: {
        'devServers/list': { servers: [] },
        'terminals/list': { processes: [] },
        'session/open': { info: sessionInfo({ id: 'review', cwd: '/project' }), seq: 0, items: [], active: [] },
        'session/changes': ({ checkpointId }) => ({
          available: true,
          checkpoints: [
            { id: 'first', label: '품절 메뉴의 담기 버튼 비활성화', createdAt: '2026-10-17T10:00:00Z', status: 'idle' },
            { id: 'second', label: '품절 상태 표시 추가', createdAt: '2026-10-17T10:05:00Z', status: 'idle' },
          ],
          files:
            checkpointId === 'second'
              ? [
                  {
                    path: 'src/components/MenuCard.tsx',
                    added: 1,
                    removed: 0,
                    diff: [
                      '@@ -19,1 +19,2 @@',
                      '   <AddToCart disabled={menu.stock === 0} />',
                      '+  {menu.stock === 0 && <span>품절</span>}',
                    ],
                  },
                ]
              : checkpointId === 'first'
                ? [
                    {
                      path: 'src/components/MenuCard.tsx',
                      added: 1,
                      removed: 1,
                      diff: ['@@ -19 +19 @@', '-  <AddToCart />', '+  <AddToCart disabled={menu.stock === 0} />'],
                    },
                  ]
                : result.files.slice(0, 2),
        }),
        'files/list': ({ path = '' }) => ({
          entries:
            path === ''
              ? [{ name: 'src', path: 'src', kind: 'directory' }]
              : path === 'src'
                ? [
                    { name: 'components', path: 'src/components', kind: 'directory' },
                    { name: 'data', path: 'src/data', kind: 'directory' },
                  ]
                : path === 'src/components'
                  ? [{ name: 'MenuCard.tsx', path: 'src/components/MenuCard.tsx', kind: 'file' }]
                  : path === 'src/data'
                    ? [{ name: 'menu.ts', path: 'src/data/menu.ts', kind: 'file' }]
                    : [],
          nextOffset: 2,
          hasMore: false,
        }),
        'files/read': ({ path, line = 1 }) => ({
          path: `/project/${path}`,
          relativePath: path,
          content:
            'export function MenuCard({ menu }) {\n  return (\n    <section>\n      <h3>{menu.name}</h3>\n      <AddToCart disabled={menu.stock === 0} />\n      {menu.stock === 0 && <span>품절</span>}\n    </section>\n  );\n}',
          startLine: 1,
          totalLines: 9,
          line,
          truncated: false,
        }),
      },
    } satisfies Script,
  },
} satisfies Meta<typeof ReviewWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SessionChanges: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /MenuCard\.tsx/ }));
    await expect(await screen.findByRole('region', { name: /MenuCard\.tsx/ })).toBeVisible();
  },
};
export const FullFileAndBack: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /MenuCard\.tsx/ }));
    await userEvent.click(await screen.findByRole('button', { name: /전체 파일 보기|View full file/ }));
    await expect(await screen.findByRole('tab', { name: /^(파일|Files)$/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(await screen.findByRole('button', { name: /변경 사항으로 돌아가기|Back to changes/ }));
    await expect(await screen.findByRole('region', { name: /MenuCard\.tsx/ })).toBeVisible();
  },
};

export const BrowseFiles: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^(파일|Files)$/ }));
    await userEvent.click(await screen.findByRole('treeitem', { name: 'src' }));
    await userEvent.click(await screen.findByRole('treeitem', { name: 'components' }));
    await userEvent.click(await screen.findByRole('treeitem', { name: 'MenuCard.tsx' }));
    await expect(
      await screen.findByRole('button', { name: /외부 에디터로 열기|Open in external editor/ }),
    ).toBeEnabled();
    await userEvent.click(await screen.findByRole('button', { name: /^(파일 목록|Files)$/ }));
    await expect(await screen.findByRole('treeitem', { name: 'MenuCard.tsx' })).toBeVisible();
  },
};

export const RequestCheckpoints: Story = {
  args: { checkpoints: true },
  play: async () => {
    const select = await screen.findByRole('combobox', { name: /비교 범위|Compare/ });
    await userEvent.selectOptions(select, 'second');
    await userEvent.click(await screen.findByRole('button', { name: /MenuCard\.tsx/ }));
    await expect(await screen.findByRole('region', { name: /MenuCard\.tsx/ })).toBeVisible();
  },
};

function sdkCommands(): Script {
  const processes: TerminalProcess[] = [
    {
      id: 'types',
      title: '타입 검사',
      command: 'pnpm typecheck',
      cwd: '/project',
      sessionId: 'review',
      kind: 'command',
      pty: false,
      pid: 4312,
      status: 'running',
      createdAt: 3,
      outputSize: 20,
      cancelled: false,
    },
    {
      id: 'test',
      title: 'SDK 단위 테스트',
      command: 'pnpm test',
      cwd: '/project',
      sessionId: 'review',
      kind: 'command',
      pty: false,
      pid: 4310,
      status: 'exited',
      exitCode: 0,
      createdAt: 2,
      outputSize: 200,
      cancelled: false,
    },
  ];
  const servers: DevServerInfo[] = [];
  let shellNumber = 0;
  const shellOutput = new Map<string, string>();
  const shellInput = new Map<string, string>();
  const stop = (id: string) => {
    const index = processes.findIndex((process) => process.id === id);
    processes[index] = { ...processes[index]!, status: 'cancelled', exitCode: -15, cancelled: true };
    return { process: processes[index]! };
  };
  return {
    results: {
      'processes/list': () => ({ processes: processes.filter((p) => p.kind !== 'shell'), tools: [] }),
      'session/cancel': {},
      'processes/stop': () => {
        for (const process of processes) if (process.status === 'running') stop(process.id);
        return { processes: [...processes], tools: [] };
      },
      'terminals/list': () => ({ processes: [...processes] }),
      'terminals/start': ({ command, title, kind, sessionId }) => {
        const process: TerminalProcess = {
          id: `shell-${++shellNumber}`,
          title: title ?? 'zsh',
          command,
          kind,
          sessionId,
          cwd: '/project',
          pty: true,
          pid: 5000 + shellNumber,
          status: 'running',
          createdAt: Date.now(),
          outputSize: 0,
          cancelled: false,
        };
        processes.push(process);
        shellOutput.set(process.id, '\x1b[36m~/sdk-project\x1b[0m ❯ ');
        return { process };
      },
      'terminals/write': ({ processId, data }) => {
        const process = processes.find((process) => process.id === processId)!;
        const next = editDemoShell(
          { text: shellOutput.get(processId) ?? '', line: shellInput.get(processId) ?? '', exitCode: null },
          data,
          '\x1b[36m~/sdk-project\x1b[0m ❯ ',
        );
        shellOutput.set(processId, next.text);
        shellInput.set(processId, next.line);
        if (next.exitCode !== null) {
          const index = processes.indexOf(process);
          processes[index] = { ...process, status: 'exited', exitCode: next.exitCode };
        }
        return { process: processes.find((process) => process.id === processId)! };
      },
      'terminals/close': ({ processId }) => {
        const index = processes.findIndex((process) => process.id === processId);
        if (index >= 0) processes.splice(index, 1);
        return { closed: true };
      },
      'terminals/read': ({ processId, offset = 0 }) => {
        const process = processes.find((process) => process.id === processId)!;
        const text =
          shellOutput.get(processId) ??
          (process.id === 'types'
            ? '> pnpm typecheck\r\n> tsc --noEmit\r\n'
            : '> pnpm test\r\nTest Files  8 passed (8)\r\nTests  42 passed (42)\r\n');
        const bytes = new TextEncoder().encode(text);
        return {
          process,
          text: new TextDecoder().decode(bytes.slice(offset)),
          nextOffset: bytes.length,
          total: bytes.length,
        };
      },
      'terminals/resize': ({ processId }) => ({ process: processes.find((process) => process.id === processId)! }),
      'terminals/stop': ({ processId }) => stop(processId),
      'devServers/list': () => ({ servers: [...servers] }),
      'devServers/start': ({ command, port }) => {
        const server: DevServerInfo = {
          id: 'preview',
          cwd: '/project',
          command,
          port,
          status: 'running',
          url: `http://localhost:${port}`,
        };
        servers.push(server);
        return { server };
      },
      'devServers/logs': ({ offset = 0 }) => {
        const text = 'Local: http://localhost:5173\n';
        return { text: offset ? '' : text, nextOffset: text.length, total: text.length };
      },
      'devServers/stop': () => {
        servers[0] = { ...servers[0]!, status: 'stopped', url: null };
        return { server: servers[0]! };
      },
    },
  };
}

export const SdkAgentCommands: Story = {
  args: { initialTab: 'processes' },
  parameters: { server: sdkCommands() },
  play: async () => {
    await expect(await screen.findByText('타입 검사')).toBeVisible();
    await expect(screen.getByText('pnpm typecheck')).toBeVisible();
    await expect(screen.queryByRole('tab', { name: /개발 서버|Dev servers/ })).not.toBeInTheDocument();
  },
};
