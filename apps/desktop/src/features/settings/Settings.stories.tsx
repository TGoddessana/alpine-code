import type { Meta, StoryObj } from '@storybook/react-vite';

import { Settings } from './Settings';

const meta = {
  title: 'Settings/Settings',
  component: Settings,
} satisfies Meta<typeof Settings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {
  parameters: {
    server: {
      results: { initialize: { protocolVersion: 1, server: { name: 'alpine-code-server', version: '0.1.0' } } },
    },
  },
};

/** No result for `initialize`, so the request fails. */
export const ServerUnavailable: Story = {
  parameters: { server: {} },
};
