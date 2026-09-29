import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: '확정' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondary: Story = {};
export const Primary: Story = { args: { variant: 'primary' } };
export const Danger: Story = { args: { variant: 'danger', children: '이번만 삭제 허용' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
