import type { SettingsGetResult } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, within } from 'storybook/test';

import {
  CHATGPT_CONNECTION,
  PROVIDERS,
  firstRunScript,
  setUpScript,
  statefulScript,
  withRouterScript,
} from '@/shared/server';

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
        'settings/get': { mode: 'default', reviewModel: null, cloneFolder: '/Users/me/AlpineCode' },
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
        'settings/get': { mode: 'auto', reviewModel: null, cloneFolder: '/Users/me/AlpineCode' },
      },
    },
  },
  play: async () => {
    await expect(
      await screen.findByRole('button', { name: /확인 모델 바꾸기|Change the checking model/ }),
    ).toBeVisible();
  },
};

/** No result for `initialize`, so the request fails. */
export const ServerUnavailable: Story = {
  parameters: { server: {} },
};

/** Board Connection: open the 'Model connection' tab. */
export const Connections: Story = {
  args: { tab: 'connection' },
  parameters: { server: setUpScript() },
};

/** The default model and the model auto mode checks with, which starts as the session's own. */
export const ConnectionsReviewModel: Story = {
  args: { tab: 'connection' },
  parameters: { server: setUpScript() },
  play: async () => {
    const picker = await screen.findByLabelText(/^(작업 승인 검토 모델|Action approval model)$/);
    await expect(picker).toHaveDisplayValue(/대화에서 사용 중인 모델과 동일|Same as the chat's current model/);
  },
};

/** A router with hundreds of models: '모델 고르기' switches which ones the picker shows. */
export const ConnectionsWithRouter: Story = {
  args: { tab: 'connection' },
  parameters: { server: withRouterScript() },
};

/** The approved layout: a ChatGPT account and two compatible API servers. */
export const ProviderOverview: Story = {
  args: { tab: 'connection' },
  parameters: {
    server: statefulScript({
      connections: {
        providers: PROVIDERS,
        defaultModel: 'router/deepseek-ai/deepseek-coder-6.7b-instruct',
        connections: [
          CHATGPT_CONNECTION,
          { name: 'router', provider: null, baseUrl: 'https://openrouter.ai/api/v1', billing: 'none', hasKey: true },
          {
            name: 'nvidia',
            provider: null,
            baseUrl: 'https://integrate.api.nvidia.com/v1',
            billing: 'none',
            hasKey: true,
          },
        ],
      },
      projects: [],
    }),
  },
};

/** Adding a connection starts with the method chooser, then uses the existing form. */
export const AddProvider: Story = {
  args: { tab: 'connection' },
  parameters: { server: firstRunScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /공급자 추가|Add provider/ }));
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByRole('button', { name: /ChatGPT/ })).toBeVisible();
    await expect(within(dialog).queryByText(/Copilot/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /API 키|API key/ }));
    await expect(await screen.findByLabelText(/^(키|API 키|Key|API key)$/)).toBeVisible();
  },
};

/** Editing and deletion are secondary actions; deletion still requires confirmation. */
export const ProviderActions: Story = {
  args: { tab: 'connection' },
  parameters: { server: setUpScript() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Anthropic 더보기|More options for Anthropic/ }));
    await expect(await screen.findByRole('menuitem', { name: /연결 편집|Edit connection/ })).toBeVisible();
    await userEvent.click(screen.getByRole('menuitem', { name: /연결 삭제|Delete connection/ }));
    const dialog = await screen.findByRole('alertdialog');
    await expect(within(dialog).getByRole('button', { name: /취소|Cancel/ })).toBeVisible();
  },
};

export const NoProviders: Story = {
  args: { tab: 'connection' },
  parameters: { server: firstRunScript() },
};

export const SignedOutProvider: Story = {
  args: { tab: 'connection' },
  parameters: {
    server: statefulScript({
      connections: {
        providers: PROVIDERS,
        defaultModel: 'chatgpt/gpt-6-astra',
        connections: [
          {
            ...CHATGPT_CONNECTION,
            hasKey: false,
            account: { email: 'you@example.com', signedIn: false, planUsage: true },
          },
        ],
      },
      projects: [],
    }),
  },
};
