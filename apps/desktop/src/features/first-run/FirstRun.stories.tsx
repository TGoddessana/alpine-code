import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, screen, userEvent, waitFor } from 'storybook/test';

import { firstRunScript } from '@/shared/server';

import { FirstRun } from './FirstRun';

/**
 * Boards FirstRun, FirstRunKey, FirstRunLocal and the ChatGPT ones (FirstRunChatGPT, …Done, …Declined). The dialog
 * opens because nothing is connected.
 */
const meta = {
  title: 'First run/Connect a model',
  component: FirstRun,
  args: { auto: true },
  parameters: { server: firstRunScript(), layout: 'fullscreen' },
} satisfies Meta<typeof FirstRun>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Methods: Story = {};

/** Decision 23: the top row is the Alpine sign-in. Google opens the browser; the welcome shows the free credits. */
export const AlpineWithGoogle: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Alpine으로 시작하기|Start with Alpine/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Google로 계속하기|Continue with Google/ }));
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    await waitFor(() => expect(screen.getByText(/무료 크레딧 300|300 free credits/)).toBeVisible(), { timeout: 4000 });
  },
};

/** The email way: a code arrives by mail; `000000` stands for a wrong one. */
export const AlpineWithEmailCode: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Alpine으로 시작하기|Start with Alpine/ }));
    await userEvent.click(await screen.findByRole('button', { name: /이메일로 코드 받기|Get a code by email/ }));
    fireEvent.input(await screen.findByLabelText(/이메일|Email/), { target: { value: 'haneul@example.com' } });
    await userEvent.click(screen.getByRole('button', { name: /코드 받기|Send code/ }));
    fireEvent.input(await screen.findByLabelText(/6자리 숫자|6-digit code/), { target: { value: '000000' } });
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  },
};

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
    await userEvent.click(await screen.findByRole('radio', { name: /^ChatGPT/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  },
};

export const ChatGPTConnected: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /^ChatGPT/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByLabelText(/모델|Model/)).toHaveValue('gpt-6-astra'), { timeout: 4000 });
  },
};

export const ChatGPTDeclined: Story = {
  parameters: { server: firstRunScript('declined') },
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: /^ChatGPT/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ChatGPT로 계속하기|Continue with ChatGPT/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /다시 허용하기|Allow again/ })).toBeVisible(), {
      timeout: 4000,
    });
  },
};
