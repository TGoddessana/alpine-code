import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test';

import { DataTab } from './DataTab';
import { ARRIVING, BOOKING_TABLES, eventsTable, useEditableTables } from './preview';
import type { DataTable } from './types';

const exported = fn();

function Panel({ tables = BOOKING_TABLES, arriving = true }: { tables?: DataTable[]; arriving?: boolean }) {
  const [live, writes] = useEditableTables(tables, arriving ? ARRIVING : null);
  return (
    <div className="flex h-screen justify-end bg-canvas-sunken">
      <div className="flex w-150 flex-col border-l border-line bg-canvas pt-4">
        <DataTab
          tables={live}
          writes={writes}
          aiReads={2}
          restorePoints={3}
          onAiReads={fn()}
          onRestorePoints={fn()}
          onExport={exported}
        />
      </div>
    </div>
  );
}

/**
 * docs/alpine-cloud.md decisions 15 and 16: every table, column and value as it is, so no separate database tool is
 * needed until real developer work. The rows are a stand-in for the published app's database; writes land in memory.
 */
const meta = {
  title: 'Alpine Cloud/Data tab',
  component: Panel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A friend books from their phone: the row opens into place a moment after the tab is shown. */
export const BookingArrives: Story = {};

export const NothingYet: Story = {
  args: { tables: BOOKING_TABLES.map((table) => ({ ...table, rows: [] })), arriving: false },
};

/** A row opens to every field; class_id points into classes, and following it opens that row. */
export const OpenRowAndFollow: Story = {
  args: { arriving: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('row', { name: /b_77d2/ }));
    await userEvent.click(await screen.findByRole('button', { name: /classes/ }));
    await waitFor(() => expect(screen.getByText('가죽 카드지갑')).toBeInTheDocument());
  },
};

/** 고치기: each field becomes an input of its type; saving takes a restore point and says so. */
export const EditRow: Story = {
  args: { arriving: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('row', { name: /b_77d2/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^고치기$|^Edit$/ }));
    fireEvent.input(await screen.findByLabelText('status (text)'), { target: { value: 'waitlisted' } });
  },
};

/** 행 추가: the same form, empty; id is set automatically. */
export const AddRow: Story = {
  args: { arriving: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /classes/ }));
    await userEvent.click(screen.getByRole('button', { name: /행 추가|Add row/ }));
  },
};

/** Deleting asks once, in place, and says it can only come back from a restore point. */
export const DeleteRow: Story = {
  args: { arriving: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('row', { name: /b_51a9/ }));
    await userEvent.click(await screen.findByRole('button', { name: /이 행 지우기|Delete this row/ }));
  },
};

/** Column filters as chips: status is confirmed. */
export const Filtered: Story = {
  args: { arriving: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^걸러보기$|^Filter$/ }));
    fireEvent.change(screen.getByLabelText(/^칸$|^Column$/), { target: { value: 'status' } });
    fireEvent.input(screen.getByLabelText(/^값$|^Value$/), { target: { value: 'confirmed' } });
    await userEvent.click(screen.getByRole('button', { name: /적용|Apply/ }));
    await waitFor(() => expect(screen.getByText(/3행 중 2행|2 of 3 rows/)).toBeInTheDocument());
  },
};

/** 5,000 rows: a hundred are drawn, the rest come on request; filters and sorting cover them all. */
export const ManyRows: Story = {
  args: { tables: [eventsTable(5000), ...BOOKING_TABLES], arriving: false },
};
