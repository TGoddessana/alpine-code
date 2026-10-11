import type { Meta, StoryObj } from '@storybook/react-vite';

import { Character } from './Character';
import { CHARACTER_COLORS, LOOKS } from './looks';
import { agentMessages } from './messages';

const meta = {
  title: 'Agent/Character',
  component: Character,
  args: { look: 'antenna', color: 2, size: 56 },
} satisfies Meta<typeof Character>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Board 캐릭터 모음: the twelve looks by rows and the eight colours by columns, 96 figures. */
export const All: Story = {
  parameters: { server: {} },
  render: () => (
    <div className="flex flex-col gap-3 p-6">
      {LOOKS.map((look) => (
        <div key={look} className="flex items-center gap-4">
          <span className="w-24 text-meta text-fg-muted">{agentMessages.ko[`look_${look}`]}</span>
          {CHARACTER_COLORS.map((color) => (
            <Character key={color} look={look} color={color} size={56} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Board 캐릭터 그림: the sizes it is drawn at, from the rail and chat (22, 32) to the agent's header (96). */
export const Sizes: Story = {
  parameters: { server: {} },
  render: () => (
    <div className="flex items-end gap-6 p-6">
      {[22, 32, 96].map((size) => (
        <Character key={size} look="hardhat" color={1} size={size} />
      ))}
    </div>
  ),
};
