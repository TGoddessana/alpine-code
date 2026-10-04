import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ExampleCards } from './ExampleCards';

/** The four example cards on an empty session. */
const meta = {
  title: 'New session/Example cards',
  component: ExampleCards,
  args: { onPick: fn() },
  decorators: [(Story) => <div className="max-w-160 p-6">{Story()}</div>],
} satisfies Meta<typeof ExampleCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Cards: Story = {};
