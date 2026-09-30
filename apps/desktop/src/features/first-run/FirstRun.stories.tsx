import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { firstRunScript } from '@/shared/server';

import { FirstRun } from './FirstRun';

/** Boards FirstRun, FirstRunKey and FirstRunLocal. The dialog opens because nothing is connected. */
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
    await userEvent.click(await screen.findByRole('button', { name: /다음|Next/ }));
    await userEvent.type(await screen.findByLabelText(/API 키|API key/), 'sk-ant-test-3f9a');
    await waitFor(() => expect(screen.getByText(/모델 3개|3 models/)).toBeVisible());
  },
};

export const ApiKeyRejected: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /다음|Next/ }));
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
