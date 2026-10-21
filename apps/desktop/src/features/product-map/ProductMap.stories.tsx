import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

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

/**
 * A map the AI is drawing, with no AI: the first read is empty, then each read of the map (the page reads it every
 * 3 seconds) has a few more cards, in the order their journeys walk them, so the cards land a few at a time.
 */
function growing(map = STUDIO_MAP, perRead = 3): Script {
  const order = [...new Set((map.flows ?? []).flatMap((flow) => flow.nodeIds ?? []))];
  const reads = Math.ceil(order.length / perRead) + 1;
  const steps = Array.from({ length: reads }, (_, step) => {
    const ids = new Set(order.slice(0, step * perRead));
    return flowScript({
      ...map,
      flows: (map.flows ?? [])
        .map((flow) => ({ ...flow, nodeIds: flow.nodeIds?.filter((id) => ids.has(id)) }))
        .filter((flow) => flow.nodeIds?.length),
      nodes: map.nodes?.filter((node) => ids.has(node.id)),
      edges: map.edges?.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    });
  });
  let read = 0;
  return {
    results: {
      'flow/get': (params, context) => {
        const step = Math.min(read++, steps.length - 1);
        const get = steps[step]!.results!['flow/get'] as (p: typeof params, c: typeof context) => object;
        return { ...get({ ...params, since: null }, context), etag: `drawing-${step}`, revision: `drawing-${step}` };
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
    localStorage.setItem('alpine.product-map.drawing:/Users/me/alpine-code', 'draw');
  },
  parameters: { server: mergeScripts(setUpScript(), flowScript(), growing(), drawingSession) },
};

/**
 * How a TF really writes a map: several agents at once, so cards of different journeys arrive mixed, a few per read,
 * and a journey's flow file only once a couple of its cards exist. Nothing is written until the map is asked.
 */
function writtenByTeam(map = STUDIO_MAP): { script: Script; started: () => void } {
  const flows = map.flows ?? [];
  const queues = flows.map((flow) => (flow.nodeIds ?? []).filter((id) => !id.startsWith('flow:')));
  // Agents take turns: one card from each part in rotation, with each read holding two to six of them.
  const order: string[] = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round++)
    queues.forEach((queue, index) => {
      const id = queue[(round + index) % Math.max(1, queue.length)];
      if (round < queue.length && id && !order.includes(id)) order.push(id);
    });
  for (const queue of queues) for (const id of queue) if (!order.includes(id)) order.push(id);
  const bursts = [3, 5, 2, 6, 4, 3, 5, 2, 6, 4];
  const steps: Script[] = [];
  for (let taken = 0, read = 0; taken < order.length; read++) {
    taken = Math.min(order.length, taken + bursts[read % bursts.length]!);
    const ids = new Set(order.slice(0, taken));
    steps.push(
      flowScript({
        ...map,
        // A flow file is written once two of its cards exist, holding only the cards written so far.
        flows: flows
          .map((flow) => ({ ...flow, nodeIds: flow.nodeIds?.filter((id) => ids.has(id) || id.startsWith('flow:')) }))
          .filter((flow) => (flow.nodeIds ?? []).filter((id) => !id.startsWith('flow:')).length >= 2),
        nodes: map.nodes?.filter((node) => ids.has(node.id)),
        edges: map.edges?.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      }),
    );
  }
  const empty = flowScript({ nodes: [], flows: [], edges: [] });
  let started = false;
  let read = 0;
  const get = (script: Script) => script.results!['flow/get'] as (p: unknown, c: unknown) => object;
  return {
    started: () => (started = true),
    script: {
      results: {
        'flow/get': (params, context) => {
          if (!started) return { ...get(empty)({ ...params, since: null }, context), etag: 'empty', revision: 'empty' };
          const step = Math.min(read++, steps.length - 1);
          return { ...get(steps[step]!)({ ...params, since: null }, context), etag: `team-${step}`, revision: 'empty' };
        },
      },
    },
  };
}

/** The page with the session it starts, as the board route keeps it. */
function AskedMap(props: Parameters<typeof ProductMap>[0]) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  return <ProductMap {...props} sessionId={sessionId} onSession={setSessionId} />;
}

const team = writtenByTeam();
/**
 * Ask an empty map: the words fly to where the map begins and wait there as its first card; then journeys and steps
 * join one by one in reading order although the agents write them mixed and in bursts. Type or just press send.
 */
export const AskToDraw: Story = {
  render: (args) => <AskedMap {...args} />,
  parameters: {
    server: mergeScripts(setUpScript(), flowScript({ nodes: [], flows: [], edges: [] }), team.script, {
      results: {
        'session/new': { info: sessionInfo({ id: 'draw', cwd: '/Users/me/alpine-code' }) },
        'session/send': {},
        'flow/prepare': () => {
          team.started();
          return {
            board: { revision: 'empty', document: { nodes: [], flows: [], edges: [] } },
            prompt: '…',
            nodeId: null,
          };
        },
        'session/open': {
          info: sessionInfo({ id: 'draw', cwd: '/Users/me/alpine-code', status: 'running' }),
          seq: 0,
          items: [],
          active: [],
        },
      },
    }),
  },
};
