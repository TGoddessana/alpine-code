import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  EXAMPLE_MAP,
  flowScript,
  mergeScripts,
  READ_ONLY_MAP,
  sessionInfo,
  setUpScript,
  STUDIO_MAP,
  type Script,
} from '@/shared/server';

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
/** Person by person, the view a project opens on. */
export const Journeys: Story = {
  beforeEach: () => {
    localStorage.setItem('alpine.product-map.view', 'journeys');
  },
};
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

/** A map the AI is drawing: each read of the map has one more flow, so the cards land a few at a time. */
function growing(): Script {
  const flows = EXAMPLE_MAP.flows ?? [];
  const steps = flows.map((_, index) => {
    const shown = flows.slice(0, index + 1);
    const ids = new Set(shown.flatMap((flow) => flow.nodeIds ?? []));
    return flowScript({
      ...EXAMPLE_MAP,
      flows: shown,
      nodes: EXAMPLE_MAP.nodes?.filter((node) => ids.has(node.id)),
      edges: EXAMPLE_MAP.edges?.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    });
  });
  let reads = 0;
  return {
    results: {
      'flow/get': (params, context) => {
        const step = Math.min(reads++, steps.length - 1);
        const read = steps[step]!.results!['flow/get'] as (p: typeof params, c: typeof context) => object;
        return { ...read({ ...params, since: null }, context), etag: `drawing-${step}`, revision: `drawing-${step}` };
      },
    },
  };
}
const drawingSession = {
  results: {
    'session/open': {
      info: sessionInfo({ id: 'draw', cwd: '/Users/me/alpine-code', status: 'running' }),
      seq: 0,
      items: [],
      active: [],
    },
  },
} satisfies Script;

/** Nothing drawn yet and the AI has just started: the empty canvas waits for the first cards. */
export const DrawingStarts: Story = {
  args: { sessionId: 'draw' },
  parameters: {
    server: mergeScripts(setUpScript(), flowScript({ nodes: [], flows: [], edges: [] }), drawingSession),
  },
};

/** The AI is drawing: cards land a flow at a time and the canvas keeps them all in view. */
export const Drawing: Story = {
  args: { sessionId: 'draw' },
  beforeEach: () => {
    localStorage.setItem('alpine.product-map.view', 'journeys');
    localStorage.setItem('alpine.product-map.drawing:/Users/me/alpine-code', 'draw');
  },
  parameters: { server: mergeScripts(setUpScript(), flowScript(), growing(), drawingSession) },
};
