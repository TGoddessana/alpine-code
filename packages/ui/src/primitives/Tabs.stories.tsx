import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs } from './Tabs';

const meta = {
  title: 'Primitives/Tabs',
  component: Tabs.Root,
} satisfies Meta<typeof Tabs.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs.Root defaultValue="general">
      <Tabs.List>
        <Tabs.Tab value="general">일반</Tabs.Tab>
        <Tabs.Tab value="connection">모델 연결</Tabs.Tab>
        <Tabs.Tab value="usage">사용량</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="general">일반 설정</Tabs.Panel>
      <Tabs.Panel value="connection">모델 연결</Tabs.Panel>
      <Tabs.Panel value="usage">사용량</Tabs.Panel>
    </Tabs.Root>
  ),
};
