import type { Meta, StoryObj } from '@storybook/react-vite';

import { EXAMPLE_MAP, flowScript, mergeScripts, setUpScript } from '@/shared/server';

import { ProductMap } from './ProductMap';

const meta = {
  title: 'Features/Product map',
  component: ProductMap,
  args: { cwd: '/Users/me/alpine-code', onSession: () => {}, demo: true },
  decorators: [
    (Story) => (
      <div className="flex h-200 w-full">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen', server: mergeScripts(setUpScript(), flowScript()) },
} satisfies Meta<typeof ProductMap>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ExistingProduct: Story = {};
export const Empty: Story = {
  parameters: { server: mergeScripts(setUpScript(), flowScript({ nodes: [], flows: [], edges: [] })) },
};
export const SDK: Story = {
  parameters: {
    server: mergeScripts(
      setUpScript(),
      flowScript({
        ...EXAMPLE_MAP,
        flows: EXAMPLE_MAP.flows?.filter((f) => f.id === 'sdk'),
        nodes: EXAMPLE_MAP.nodes?.filter((n) => ['sdk-call', 'payment', 'receipt'].includes(n.id)),
        edges: EXAMPLE_MAP.edges?.filter(
          (e) => ['sdk-call', 'payment'].includes(e.source) && ['payment', 'receipt'].includes(e.target),
        ),
      }),
    ),
  },
};
export const English: Story = { globals: { locale: 'en' } };
