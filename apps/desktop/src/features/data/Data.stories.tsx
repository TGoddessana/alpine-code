import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test';

import { publishServer } from '@/shared/server';

import { DataPanel } from './DataPanel';

const exported = fn();

function Panel() {
  return (
    <div className="flex h-screen justify-end bg-canvas-sunken">
      <div className="flex w-150 flex-col border-l border-line bg-canvas pt-4">
        <DataPanel cwd="/project" onExport={exported} onRestorePoints={fn()} />
      </div>
    </div>
  );
}

/**
 * docs/alpine-cloud.md decisions 15 and 16: every table, column and value as it is, so no separate database tool is
 * needed until real developer work. The practice data on this Mac can be edited; the live data of the published app is
 * only looked at. The rows come from `data/*` of the scripted server.
 */
const meta = {
  title: 'Alpine Cloud/Data tab',
  component: Panel,
  parameters: { layout: 'fullscreen', server: publishServer({ data: 'live' }) },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = (name: RegExp) => screen.findByRole('row', { name }, { timeout: 8000 });

/** The live data, read-only: a friend books from their phone and the row opens into place within five seconds. */
export const BookingArrives: Story = {
  parameters: { server: publishServer({ data: 'live', bookingArrivesMs: 1500 }) },
  play: async () => {
    await row(/^1$/);
    await waitFor(() => expect(screen.getByRole('row', { name: /^4$/ })).toBeInTheDocument(), { timeout: 9000 });
  },
};

/** Live rows open to every field, with no way to change them: a line says changes go through the AI. */
export const LiveIsReadOnly: Story = {
  play: async () => {
    await userEvent.click(await row(/^1$/));
    await expect(screen.queryByRole('button', { name: /^고치기$|^Edit$/ })).toBeNull();
    await expect(screen.queryByRole('button', { name: /행 추가|Add row/ })).toBeNull();
  },
};

/** The practice data on this Mac: the label says so, and rows can be edited, added and deleted. */
export const PracticeData: Story = {
  parameters: { server: publishServer({ data: 'practice' }) },
};

/** With both, a switch picks which one is shown; the live data comes first. */
export const BothSources: Story = {
  parameters: { server: publishServer({ data: 'both' }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /연습 데이터|Practice data/ }, { timeout: 8000 }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /연습 데이터|Practice data/ })).toHaveAttribute('aria-pressed', 'true'),
    );
  },
};

/** What the AI read from the live data, newest first. */
export const AiReadLog: Story = {
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /AI가 읽은 기록 2건|2 AI reads/ }, { timeout: 8000 }),
    );
    await expect(await screen.findByText(/SELECT status, count/)).toBeInTheDocument();
  },
};

export const NothingYet: Story = {
  parameters: { server: publishServer({ data: 'live', empty: true }) },
};

/** A row opens to every field; class_id points into classes, and following it opens that row. */
export const OpenRowAndFollow: Story = {
  play: async () => {
    await userEvent.click(await row(/^2$/));
    await userEvent.click(await screen.findByRole('button', { name: /classes/ }));
    await waitFor(() => expect(screen.getByText('가죽 카드지갑')).toBeInTheDocument());
  },
};

/** 고치기: each field becomes an input of its type; a secret column stays hidden. */
export const EditRow: Story = {
  parameters: { server: publishServer({ data: 'practice' }) },
  play: async () => {
    await userEvent.click(await row(/^1$/));
    await userEvent.click(await screen.findByRole('button', { name: /^고치기$|^Edit$/ }));
    fireEvent.input(await screen.findByLabelText('status (text)'), { target: { value: 'waitlisted' } });
  },
};

/** 행 추가: the same form, empty; the id is set automatically. */
export const AddRow: Story = {
  parameters: { server: publishServer({ data: 'practice' }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /classes/ }, { timeout: 8000 }));
    await userEvent.click(screen.getByRole('button', { name: /행 추가|Add row/ }));
  },
};

/** Deleting asks once, in place. */
export const DeleteRow: Story = {
  parameters: { server: publishServer({ data: 'practice' }) },
  play: async () => {
    await userEvent.click(await row(/^1$/));
    await userEvent.click(await screen.findByRole('button', { name: /이 행 지우기|Delete this row/ }));
  },
};

/** Column filters as chips: status is confirmed. */
export const Filtered: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^걸러보기$|^Filter$/ }, { timeout: 8000 }));
    fireEvent.change(screen.getByLabelText(/^칸$|^Column$/), { target: { value: 'status' } });
    fireEvent.input(screen.getByLabelText(/^값$|^Value$/), { target: { value: 'confirmed' } });
    await userEvent.click(screen.getByRole('button', { name: /적용|Apply/ }));
    await waitFor(() => expect(screen.getByText(/3행 중 2행|2 of 3 rows/)).toBeInTheDocument());
  },
};

/** 5,000 rows: the first 500 are asked for and a hundred are drawn; the rest come on request. */
export const ManyRows: Story = {
  parameters: { server: publishServer({ data: 'live', eventRows: 5000 }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /events/ }, { timeout: 8000 }));
  },
};
