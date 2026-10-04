import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { PanelToggle } from './PanelToggle';
import { WorkResult } from './WorkResult';

/** The right panel on its own, next to an empty conversation. */
const meta = {
  title: 'Work result/WorkResult',
  component: WorkResult,
  args: { onClose: fn(), result: { files: [], commands: [] } },
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="flex h-screen justify-end bg-canvas-sunken">{Story()}</div>],
} satisfies Meta<typeof WorkResult>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing changed or ran yet: one line, not a list of empty parts. */
export const NothingYet: Story = {
  play: async () => {
    await expect(await screen.findByText(/아직 바뀐 파일이나|No files changed/)).toBeVisible();
  },
};

/** The changed files (the first one opened to its diff), then the commands with how each went. */
export const AfterWork: Story = {
  args: {
    result: {
      files: [
        {
          path: 'src/components/MenuCard.tsx',
          added: 4,
          removed: 1,
          diff: [
            '@@ -18,3 +18,6 @@',
            '   <h3>{menu.name}</h3>',
            '+  {menu.stock === 0 && (',
            '+    <span className="soldout">품절</span>',
            '+  )}',
            '-  <AddToCart />',
            '+  <AddToCart disabled={menu.stock === 0} />',
          ],
        },
        { path: 'src/components/AddToCart.tsx', added: 6, removed: 1, diff: ['@@ -1 +1 @@', '-x', '+y'] },
        { path: 'src/data/menu.ts', added: 0, removed: 0, diff: null },
      ],
      commands: [
        { id: 'c1', command: 'npm run dev', status: 'done' },
        { id: 'c2', command: 'npm test -- menu', status: 'error' },
        { id: 'c3', command: 'npm run build', status: 'running' },
      ],
    },
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /MenuCard\.tsx/ }));
    await expect(await screen.findByRole('region', { name: /MenuCard\.tsx/ })).toBeVisible();
  },
};

/** The header button: while the panel is closed it counts the changed files. */
export const Toggle: StoryObj<typeof PanelToggle> = {
  render: () => (
    <div className="flex gap-2 p-6">
      <PanelToggle open={false} files={0} onToggle={() => {}} />
      <PanelToggle open={false} files={3} onToggle={() => {}} />
      <PanelToggle open files={3} onToggle={() => {}} />
    </div>
  ),
};
