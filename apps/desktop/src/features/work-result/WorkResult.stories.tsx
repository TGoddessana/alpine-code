import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { WorkResult } from './WorkResult';

/** The work result tab's content on its own (the dock supplies the frame). */
const meta = {
  title: 'Work result/WorkResult',
  component: WorkResult,
  args: { result: { files: [], commands: [] } },
  decorators: [(Story) => <div className="w-90 bg-canvas p-5">{Story()}</div>],
} satisfies Meta<typeof WorkResult>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No work is connected to the page (the product map without a session). */
export const NotConnected: Story = {
  args: { result: null },
  play: async () => {
    await expect(await screen.findByText(/아직 연결된 작업이|No work is connected/)).toBeVisible();
  },
};

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
