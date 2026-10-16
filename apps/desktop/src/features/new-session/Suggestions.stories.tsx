import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Suggestions } from './Suggestions';

/** The three suggestions on an empty session. */
const meta = {
  title: 'New session/Suggestions',
  component: Suggestions,
  args: { onPick: fn() },
  decorators: [(Story) => <div className="max-w-175 p-6">{Story()}</div>],
} satisfies Meta<typeof Suggestions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Lines: Story = {};
