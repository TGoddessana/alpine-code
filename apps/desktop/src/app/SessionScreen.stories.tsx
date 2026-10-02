import type { Meta, StoryObj } from '@storybook/react-vite';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { Session } from '@/features/session/Session';
import { StatusPanel } from '@/features/status-panel/StatusPanel';
import {
  mergeScripts,
  MONOREPO_ITEMS,
  MONOREPO_PLAN,
  sessionInfo,
  sessionScript,
  setUpScript,
  useSession,
  WORK_ITEMS,
  WORK_PLAN,
  type Item,
} from '@/shared/server';

const ID = 's-board';

/** The session route as the app puts it together, without the rail: the chat and the right panel side by side. */
function SessionScreen({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  return (
    <div className="flex h-screen overflow-hidden bg-canvas-sunken">
      <Session sessionId={sessionId} />
      <StatusPanel info={session.data?.info ?? null} />
    </div>
  );
}

function board(info: Parameters<typeof sessionInfo>[0], items: Item[]) {
  return mergeScripts(setUpScript(), sessionScript({ sessions: [{ info: sessionInfo({ id: ID, ...info }), items }] }));
}

/** Boards with a plan: the chat's plan and check rows next to the panel they fill. */
const meta = {
  title: 'Screens/Session with panel',
  component: SessionScreen,
  args: { sessionId: ID },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: () => Story() }) });
      return <RouterProvider router={router} />;
    },
  ],
} satisfies Meta<typeof SessionScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const started = new Date(Date.now() - 62_000).toISOString();

/**
 * Board Task2Work: the run is on its second step. The opened tool line holds the `계획` row; clicking its result
 * opens the plan tab, and the panel keeps its width.
 */
export const Task2Work: Story = {
  parameters: {
    server: board(
      {
        title: '세션 목록이 사라지는 문제',
        status: 'running',
        activity: { kind: 'thinking', toolName: null, since: started },
        runStartedAt: started,
        runUsage: {
          inputTokens: 2_400,
          outputTokens: 940,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          requests: 3,
          cost: 0,
        },
        plan: WORK_PLAN,
      },
      WORK_ITEMS,
    ),
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /명령 1개 실행.*계획 1번 고침|Ran 1 command/ }));
    const panel = screen.getByRole('complementary', { name: /세션 상태|Session status/ });
    const width = panel.style.width;
    await userEvent.click(await screen.findByRole('button', { name: /'원인 경로 찾기' 끝냄|Finished/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /계획|Plan/, selected: true })).toBeVisible());
    await expect(
      within(screen.getByRole('tabpanel', { name: /^(계획|Plan)/ })).getByText('재현 테스트 먼저'),
    ).toBeVisible();
    await expect(panel.style.width).toBe(width);
  },
};

/** The same board with every part on one tab, as it first opens. */
export const Task2WorkAll: Story = {
  parameters: Task2Work.parameters,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /명령 1개 실행.*계획 1번 고침|Ran 1 command/ }));
  },
};

/** Board StressMonorepo: checks by package, one not run, and a step dropped from the plan. */
export const StressMonorepo: Story = {
  parameters: {
    server: board({ title: '주문 API 페이지네이션', cwd: '/Users/me/acme', plan: MONOREPO_PLAN }, MONOREPO_ITEMS),
  },
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /명령 1개 실행 · 2번 확인 · 실패 1|Ran 1 command/ }),
    );
    const shown = within(await screen.findByRole('tabpanel'));
    await expect(shown.getByText(/계획에서 뺀 단계 · e2e|Step dropped from the plan · e2e/)).toBeVisible();
  },
};
