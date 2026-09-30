import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { firstRunScript } from '@/shared/server';

import { FirstRun } from './FirstRun';

/**
 * Boards FirstRun, FirstRunKey, FirstRunLocal and the ChatGPT ones (FirstRunChatGPT, …Done, …Declined). The dialog
 * opens because nothing is connected.
 */
const meta = {
  title: 'First run/Connect a model',
  component: FirstRun,
  parameters: { server: firstRunScript(), layout: 'fullscreen' },
} satisfies Meta<typeof FirstRun>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Methods: Story = {};

export const ApiKeyChecked: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /^API 키|^API key/ }));
    await userEvent.click(screen.getByRole('button', { name: /다음|Next/ }));
    await userEvent.type(await screen.findByLabelText(/API 키|API key/), 'sk-ant-test-3f9a');
    await waitFor(() => expect(screen.getByText(/모델 3개|3 models/)).toBeVisible());
  },
};

export const ApiKeyRejected: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /^API 키|^API key/ }));
    await userEvent.click(screen.getByRole('button', { name: /다음|Next/ }));
    await userEvent.type(await screen.findByLabelText(/API 키|API key/), 'wrong-key');
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  },
};

export const LocalServer: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /로컬|Local/ }));
    await userEvent.click(screen.getByRole('button', { name: /다음|Next/ }));
    await waitFor(() => expect(screen.getByText(/모델 2개|2 models/)).toBeVisible());
  },
};

/** The browser is open; the scripted sign-in ends a moment later. */
export const ChatGPTWaiting: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  },
};

export const ChatGPTConnected: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByLabelText(/모델|Model/)).toHaveValue('gpt-6-astra'), { timeout: 4000 });
  },
};

export const ChatGPTDeclined: Story = {
  parameters: { server: firstRunScript('declined') },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /다시 허용하기|Allow again/ })).toBeVisible(), {
      timeout: 4000,
    });
  },
};
