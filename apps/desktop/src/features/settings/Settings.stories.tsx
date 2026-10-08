import type { SettingsGetResult } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';

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
        'settings/get': { mode: 'default', reviewModel: null },
        'settings/setMode': ({ mode }: SettingsGetResult) => ({ mode }),
      },
    },
  },
};

/** With 알아서 하기 as the new-session safety, a link goes to the model that checks. */
export const GeneralAuto: Story = {
  parameters: {
    server: {
      results: {
        initialize: { protocolVersion: 1, server: { name: 'alpine-code-server', version: '0.1.0' } },
        'settings/get': { mode: 'auto', reviewModel: null },
      },
    },
  },
  play: async () => {
    await expect(await screen.findByRole('button', { name: /확인 모델 바꾸기|Change the checking model/ })).toBeVisible();
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

/** The default model and the model auto mode checks with, which starts as the session's own. */
export const ConnectionsReviewModel: Story = {
  args: { tab: 'connection' },
  parameters: { server: setUpScript() },
  play: async () => {
    const picker = await screen.findByLabelText(/^(확인|Checks)$/);
    await expect(picker).toHaveDisplayValue(/세션 모델과 같게|Same as the session's model/);
  },
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
