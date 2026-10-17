import type { DevServerInfo } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DevelopmentServers } from './DevelopmentServers';

const server: DevServerInfo = {
  id: 'dev-1',
  cwd: '/workspace/bakery',
  command: 'pnpm dev',
  port: 5173,
  url: 'http://localhost:5173',
  processId: 'process-1',
  status: 'running',
  external: false,
};
const meta = {
  title: 'Workspace/Development servers',
  component: DevelopmentServers,
  args: { cwd: '/workspace/bakery' },
  parameters: {
    server: {
      results: {
        'devServers/list': { servers: [server] },
        'devServers/logs': ({ offset }: { offset: number }) => ({
          text: offset ? '' : '> bakery dev\nVITE ready\nLocal: http://localhost:5173/\n',
          nextOffset: 65,
          total: 65,
        }),
        'devServers/start': { server },
        'devServers/stop': { server: { ...server, status: 'stopped', url: null } },
        'devServers/restart': { server },
      },
    },
  },
} satisfies Meta<typeof DevelopmentServers>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Running: Story = {};
export const Empty: Story = { parameters: { server: { results: { 'devServers/list': { servers: [] } } } } };
export const PortConflict: Story = {
  parameters: {
    server: {
      results: {
        'devServers/list': { servers: [] },
        'devServers/start': { conflict: { port: 5173, pid: 1042, cwd: '/workspace/bakery', canReuse: true } },
      },
    },
  },
};
