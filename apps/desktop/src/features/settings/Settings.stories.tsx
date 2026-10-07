import type { SettingsGetResult } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { setUpScript, withRouterScript } from '@/shared/server';

import { Settings } from './Settings';

const meta = {
  title: 'Settings/Settings',
  component: Settings,
  args: { onChange: () => {} },
} satisfies Meta<typeof Settings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {
  parameters: {
    server: {
      results: {
        initialize: { protocolVersion: 1, server: { name: 'alpine-code-server', version: '0.1.0' } },
        'settings/get': { mode: 'default' },
        'settings/setMode': ({ mode }: SettingsGetResult) => ({ mode }),
      },
    },
  },
};

/** No result for `initialize`, so the request fails. */
export const ServerUnavailable: Story = {
  parameters: { server: {} },
};

/** Board Connection: open the 'Model connection' tab. */
export const Connections: Story = {
  parameters: { server: setUpScript() },
};

/** A router with hundreds of models: '모델 고르기' switches which ones the picker shows. */
export const ConnectionsWithRouter: Story = {
  args: { tab: 'connection' },
  parameters: { server: withRouterScript() },
};

/** Board Tools: profiles, the tools they turn on, a file changed outside the app and a broken one. */
export const Tools: Story = {
  args: { tab: 'tools', profile: 'p-shop', saved: 'fetch' },
  parameters: { server: setUpScript() },
};
