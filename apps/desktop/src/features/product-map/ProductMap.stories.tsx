import type { Meta, StoryObj } from '@storybook/react-vite';

import { EXAMPLE_MAP, flowScript, mergeScripts, READ_ONLY_MAP, setUpScript, STUDIO_MAP } from '@/shared/server';

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
/** A realistic booking service: tagged features, six flows, shared features, loops, and every status. */
export const RealisticService: Story = {
  parameters: { server: mergeScripts(setUpScript(), flowScript(STUDIO_MAP)) },
};
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
/** A map written by a newer Alpine: shown, not editable. */
export const ReadOnly: Story = {
  parameters: { server: mergeScripts(setUpScript(), flowScript(READ_ONLY_MAP)) },
};
export const English: Story = { globals: { locale: 'en' } };
